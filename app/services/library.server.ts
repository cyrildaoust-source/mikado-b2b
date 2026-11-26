import db from "../db.server";
import { LIBRARY_MAX_BYTES, type LibraryEntry } from "../domain/library";
import { imageSize } from "./image-size";
import { RUBELLI_IMAGE } from "../domain/rubelli";
import { DG_IMAGE, type DgKind } from "../domain/designersguild";

const MIMES = ["image/jpeg", "image/png", "image/webp"];
const select = { id: true, maker: true, collection: true, colour: true, width: true, height: true };
const clean = (s: unknown, max: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Toute la bibliothèque, sans les photos (servies à part). */
export async function listLibrary(): Promise<LibraryEntry[]> {
  return db.libraryMaterial.findMany({ select, orderBy: [{ maker: "asc" }, { collection: "asc" }, { colour: "asc" }] });
}

export async function addLibrary(input: { maker: unknown; collection: unknown; colour: unknown; file: File }) {
  const maker = clean(input.maker, 80),
    collection = clean(input.collection, 120),
    colour = clean(input.colour, 60);
  if (!maker) throw Error("Indiquez l'éditeur.");
  if (!collection) throw Error("Indiquez la collection.");
  const f = input.file;
  if (!MIMES.includes(f.type)) throw Error("Format accepté : JPEG, PNG ou WebP.");
  if (f.size > LIBRARY_MAX_BYTES) throw Error("Photo trop lourde.");
  const bytes = new Uint8Array(await f.arrayBuffer());
  const size = imageSize(bytes, f.type);
  if (!size) throw Error("Photo illisible.");
  // Même éditeur, collection et coloris : la nouvelle photo remplace l'ancienne.
  const same = await db.libraryMaterial.findFirst({
    where: { maker: { equals: maker, mode: "insensitive" }, collection: { equals: collection, mode: "insensitive" }, colour: { equals: colour, mode: "insensitive" } },
    select: { id: true },
  });
  const data = { maker, collection, colour, mime: f.type, data: bytes, width: size.width, height: size.height };
  return same
    ? db.libraryMaterial.update({ where: { id: same.id }, data, select })
    : db.libraryMaterial.create({ data, select });
}

export async function updateLibrary(id: string, input: { maker: unknown; collection: unknown; colour: unknown }) {
  const maker = clean(input.maker, 80),
    collection = clean(input.collection, 120);
  if (!maker || !collection) throw Error("L'éditeur et la collection sont obligatoires.");
  return db.libraryMaterial.update({
    where: { id },
    data: { maker, collection, colour: clean(input.colour, 60) },
    select,
  });
}

/** Retire une matière. Les planches qui l'utilisent la gardent dans leur dernier export. */
export async function deleteLibrary(ids: string[]) {
  await db.libraryMaterial.deleteMany({ where: { id: { in: ids } } });
}

const DEDAR_REMOTE = /^https:\/\/cdn\.dedar\.com\/bc-(?:swatch|variant)-\d+-[a-f0-9]+\.(?:jpe?g|png|webp)$/i;
const REMOTE = { test: (u: string) => DEDAR_REMOTE.test(u) || RUBELLI_IMAGE.test(u) || DG_IMAGE.test(u) };

/** Photo d'une matière : copie en base, ou vignette lue chez l'éditeur en 800 px. */
export async function getLibraryImage(id: string): Promise<{ mime: string; data: Uint8Array } | null> {
  const row = await db.libraryMaterial.findUnique({ where: { id }, select: { mime: true, data: true, remote: true } });
  if (!row) return null;
  if (row.data) return { mime: row.mime, data: row.data };
  return row.remote ? remoteImage(row.remote) : null;
}

async function remoteImage(url: string) {
  if (!REMOTE.test(url)) return null;
  try {
    // Dedar redimensionne à la demande ; Rubelli donne déjà la taille dans le nom du fichier.
    const r = await fetch(DEDAR_REMOTE.test(url) ? `${url}?format=jpg&width=800` : url, {
      headers: { "User-Agent": "MikadoDecoPro/1.0 (bibliotheque de matieres)", Accept: "image/jpeg,image/*;q=0.8" },
      signal: AbortSignal.timeout(15_000),
    });
    const mime = r.headers.get("content-type")?.split(";")[0] || "";
    if (!r.ok || !MIMES.includes(mime)) return null;
    const data = new Uint8Array(await r.arrayBuffer());
    return data.length > LIBRARY_MAX_BYTES * 4 ? null : { mime, data };
  } catch {
    return null;
  }
}

/** Coloris dont la photo reste chez l'éditeur (une ligne, aucune copie de l'image). */
export async function addRemoteLibrary(input: { maker: string; collection: string; colour: string; remote: string; previous?: string }) {
  const maker = clean(input.maker, 80),
    collection = clean(input.collection, 120),
    colour = clean(input.colour, 60);
  if (!maker || !collection || !REMOTE.test(input.remote)) throw Error("Coloris invalide.");
  // Une vignette de l'éditeur n'entre qu'une fois, même si deux fiches portent le même nom.
  // L'ancienne adresse (vignette 150 px) est reprise en place : les planches gardent la matière.
  const same = await db.libraryMaterial.findFirst({
    where: { remote: { in: [input.remote, ...(input.previous ? [input.previous] : [])] } },
    select: { id: true },
  });
  // Dimensions inconnues (0) : l'éditeur de planche mesure la photo à l'affichage.
  const data = { maker, collection, colour, mime: "image/jpeg", data: null, remote: input.remote, width: 0, height: 0 };
  return same
    ? db.libraryMaterial.update({ where: { id: same.id }, data, select })
    : db.libraryMaterial.create({ data, select });
}

export async function existingLibrary(ids: string[]) {
  if (!ids.length) return new Set<string>();
  const rows = await db.libraryMaterial.findMany({ where: { id: { in: ids } }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

// ——— Import des packs d'images Kvadrat (accord de Cyril, partenaire, 26/11/2026) ———

const KVADRAT_PACK = "https://kvadrat-downloadcenter.azurewebsites.net/api/downloadcenter/downloadimages/";

/**
 * Pack d'images basse résolution d'un produit Kvadrat, tel que la fiche
 * publique le propose. Les photos dont le nom porte un coloris entrent dans
 * la bibliothèque ; les photos d'ambiance sont laissées de côté.
 */
export async function importKvadratProduct(product: string, collection: string, dry = false) {
  const { listZip, zipImages, readZipEntry, mimeOf } = await import("../domain/zip");
  const { kvadratColour } = await import("../domain/library");
  const r = await fetch(`${KVADRAT_PACK}${product}?culture=en&lowResolution=true`, {
    headers: { "User-Agent": "MikadoDecoPro/1.0 (bibliotheque de matieres)" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw Error(`Kvadrat répond ${r.status} pour le produit ${product}.`);
  const buf = await r.arrayBuffer();
  const images = zipImages(listZip(buf));
  const report = { product, collection, bytes: buf.byteLength, images: images.length, imported: 0, skipped: [] as string[], names: images.slice(0, 12).map((e) => e.name) };
  if (dry) return report;
  for (const e of images) {
    const name = e.name.split("/").pop() || e.name;
    const colour = kvadratColour(e.name, product);
    if (!colour) {
      report.skipped.push(`${name} (sans coloris)`);
      continue;
    }
    const data = await readZipEntry(buf, e);
    if (data.length > LIBRARY_MAX_BYTES) {
      report.skipped.push(`${name} (trop lourde)`);
      continue;
    }
    try {
      await addLibrary({ maker: "Kvadrat", collection, colour, file: new File([data], name, { type: mimeOf(name) }) });
      report.imported++;
    } catch (err) {
      report.skipped.push(`${name} (${err instanceof Error ? err.message : "erreur"})`);
    }
  }
  return report;
}

// ——— Import des coloris Dedar (fiches publiques de dedar.com) ———

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Plusieurs fiches Dedar à la suite, une page par seconde au plus. */
export async function importDedarBatch(from: number, count: number) {
  const slugs = await dedarSlugs();
  const part = slugs.slice(from, from + count);
  const done: { product: string; collection?: string; imported?: number; error?: string }[] = [];
  for (const slug of part) {
    await pause(1000);
    try {
      const r = await importDedarProduct(slug);
      done.push({ product: slug, collection: r.collection, imported: r.imported });
    } catch (e) {
      done.push({ product: slug, error: e instanceof Error ? e.message : "erreur" });
    }
  }
  const imported = done.reduce((n, d) => n + (d.imported || 0), 0);
  return { total: slugs.length, from, next: from + part.length < slugs.length ? from + part.length : null, imported, done };
}
const UA = { "User-Agent": "MikadoDecoPro/1.0 (bibliotheque de matieres)" };

export async function dedarSlugs() {
  const { DEDAR_SITE, dedarProductSlugs } = await import("../domain/dedar");
  const r = await fetch(`${DEDAR_SITE}/__sitemap__/products.xml`, { headers: UA, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw Error(`Dedar répond ${r.status} pour le plan du site.`);
  return dedarProductSlugs(await r.text());
}

/**
 * Coloris d'une fiche Dedar : une requête pour la page. Les vignettes restent
 * sur cdn.dedar.com et sont lues à l'affichage (getLibraryImage).
 */
export async function importDedarProduct(slug: string, dry = false) {
  const { DEDAR_SITE, dedarAllSwatches, dedarCollection, dedarPayloadTrace } = await import("../domain/dedar");
  const r = await fetch(`${DEDAR_SITE}/products/${slug}/`, { headers: UA, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw Error(`Dedar répond ${r.status} pour ${slug}.`);
  const html = await r.text();
  const swatches = dedarAllSwatches(html, slug);
  let collection = dedarCollection(swatches, slug);
  // Papier peint et tissu portent parfois le même nom : on les distingue.
  if (/-wall(-|$)/.test(slug) && !/wall/i.test(collection)) collection += " Wall";
  const report = { product: slug, collection, swatches: swatches.length, imported: 0, skipped: [] as string[], sample: swatches.slice(0, 5) };
  if (dry) {
    // Diagnostic : vignettes présentes ailleurs que dans les balises img (données de la page).
    const ids = [...new Set(html.match(/bc-swatch-\d+-[a-f0-9]+/g) || [])];
    const known = new Set(swatches.map((s) => s.src.match(/bc-swatch-\d+-[a-f0-9]+/)?.[0]));
    const other = ids.find((id) => !known.has(id));
    let trace: unknown = null;
    try {
      trace = other ? dedarPayloadTrace(html, other) : null;
    } catch (e) {
      trace = String(e);
    }
    // Contrôle : la première vignette se lit comme à l'affichage.
    const probe = swatches[0] ? await remoteImage(swatches[0].image || swatches[0].src) : null;
    const size = probe ? imageSize(probe.data, probe.mime) : null;
    return { ...report, probe: probe ? { mime: probe.mime, bytes: probe.data.length, size } : null, colourNames: swatches.slice(0, 5).map((s) => s.tint || null), colours: swatches.map((s) => s.colour), allSwatchIds: ids.length, missing: other || null, trace };
  }
  for (const s of swatches) {
    try {
      const colour = s.tint ? `${s.colour} ${s.tint}` : s.colour;
      await addRemoteLibrary({ maker: "Dedar", collection, colour, remote: s.image || s.src, previous: s.src });
      report.imported++;
    } catch (err) {
      report.skipped.push(`${s.colour} (${err instanceof Error ? err.message : "erreur"})`);
    }
  }
  return report;
}

// ——— Import des coloris Rubelli (fiches publiques de rubelli.com) ———

/** Une fiche Rubelli : une requête pour la page, les photos restent sur cdn.rubelli.com. */
export async function importRubelliProduct(slug: string, dry = false) {
  const { RUBELLI_SITE, rubelliColours, rubelliReplaced } = await import("../domain/rubelli");
  const r = await fetch(`${RUBELLI_SITE}/en/${slug}`, { headers: UA, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw Error(`Rubelli répond ${r.status} pour ${slug}.`);
  const html = await r.text();
  if (rubelliReplaced(html)) return { product: slug, replaced: true, colours: 0, imported: 0, skipped: [] as string[] };
  const colours = rubelliColours(html);
  const report = { product: slug, collection: colours[0]?.collection || "", colours: colours.length, imported: 0, skipped: [] as string[] };
  if (dry) {
    const probe = colours[0] ? await remoteImage(colours[0].image) : null;
    return { ...report, sample: colours.slice(0, 5), probe: probe ? { mime: probe.mime, bytes: probe.data.length, size: imageSize(probe.data, probe.mime) } : null };
  }
  for (const c of colours) {
    try {
      await addRemoteLibrary({ maker: "Rubelli", collection: c.collection, colour: c.colour, remote: c.image });
      report.imported++;
    } catch (err) {
      report.skipped.push(`${c.colour} (${err instanceof Error ? err.message : "erreur"})`);
    }
  }
  return report;
}

/** Une page de la liste « textiles » (12 fiches), une page par seconde au plus. */
export async function importRubelliPage(page: number, dry = false) {
  const { RUBELLI_SITE, rubelliListing } = await import("../domain/rubelli");
  const r = await fetch(`${RUBELLI_SITE}/en/textiles?p=${page}`, { headers: UA, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw Error(`Rubelli répond ${r.status} pour la page ${page}.`);
  const slugs = rubelliListing(await r.text());
  if (dry) return { page, products: slugs };
  const done: unknown[] = [];
  let imported = 0;
  for (const slug of slugs) {
    await pause(1000);
    try {
      const rep = await importRubelliProduct(slug);
      imported += rep.imported;
      done.push({ product: slug, collection: "collection" in rep ? rep.collection : undefined, imported: rep.imported, ...("replaced" in rep ? { replaced: true } : {}) });
    } catch (e) {
      done.push({ product: slug, error: e instanceof Error ? e.message : "erreur" });
    }
  }
  return { page, products: slugs.length, imported, done };
}

// ——— Import Designers Guild (catalogue public de designersguild.com) ———

/** Une page catalogue (tissus ou papiers peints), une seule requête ; `count` coloris à partir de `from`. */
export async function importDesignersGuild(kind: DgKind, from: number, count: number, dry = false) {
  const { DG_SITE, dgCards, dgColours } = await import("../domain/designersguild");
  const r = await fetch(`${DG_SITE}/${kind}`, { headers: UA, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw Error(`Designers Guild répond ${r.status}.`);
  const colours = dgColours(dgCards(await r.text()));
  const part = colours.slice(from, from + count);
  const report = { kind, total: colours.length, from, next: from + part.length < colours.length ? from + part.length : null, imported: 0, skipped: [] as string[] };
  if (dry) {
    const probe = part[0] ? await remoteImage(part[0].image) : null;
    return { ...report, sample: part.slice(0, 8), probe: probe ? { mime: probe.mime, bytes: probe.data.length, size: imageSize(probe.data, probe.mime) } : null };
  }
  for (const c of part) {
    try {
      await addRemoteLibrary({ maker: "Designers Guild", collection: kind === "wallpaper" ? `${c.collection} Wall` : c.collection, colour: c.colour, remote: c.image });
      report.imported++;
    } catch (err) {
      report.skipped.push(`${c.collection} ${c.colour} (${err instanceof Error ? err.message : "erreur"})`);
    }
  }
  return report;
}
