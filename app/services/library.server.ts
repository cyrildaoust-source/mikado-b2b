import db from "../db.server";
import { LIBRARY_MAX_BYTES, type LibraryEntry } from "../domain/library";
import { imageSize } from "./image-size";

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

export async function getLibraryImage(id: string) {
  return db.libraryMaterial.findUnique({ where: { id }, select: { mime: true, data: true } });
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
const UA = { "User-Agent": "MikadoDecoPro/1.0 (bibliotheque de matieres)" };

export async function dedarSlugs() {
  const { DEDAR_SITE, dedarProductSlugs } = await import("../domain/dedar");
  const r = await fetch(`${DEDAR_SITE}/__sitemap__/products.xml`, { headers: UA, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw Error(`Dedar répond ${r.status} pour le plan du site.`);
  return dedarProductSlugs(await r.text());
}

/**
 * Coloris d'une fiche Dedar : la page, puis chaque vignette en 800 px, une
 * requête par seconde au plus.
 */
export async function importDedarProduct(slug: string, dry = false) {
  const { DEDAR_SITE, dedarAllSwatches, dedarCollection, dedarPayloadTrace } = await import("../domain/dedar");
  const r = await fetch(`${DEDAR_SITE}/products/${slug}/`, { headers: UA, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw Error(`Dedar répond ${r.status} pour ${slug}.`);
  const html = await r.text();
  const swatches = dedarAllSwatches(html);
  const collection = dedarCollection(swatches, slug);
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
    return { ...report, colours: swatches.map((s) => s.colour), allSwatchIds: ids.length, missing: other || null, trace };
  }
  for (const s of swatches) {
    await pause(1000);
    try {
      const img = await fetch(`${s.src}?format=jpg&width=800`, {
        headers: { ...UA, Accept: "image/jpeg,image/webp;q=0.9,image/png;q=0.8" },
        signal: AbortSignal.timeout(30_000),
      });
      const mime = img.headers.get("content-type")?.split(";")[0] || "";
      if (!img.ok) throw Error(`HTTP ${img.status}`);
      const data = new Uint8Array(await img.arrayBuffer());
      await addLibrary({ maker: "Dedar", collection, colour: s.colour, file: new File([data], `${slug}-${s.colour}.jpg`, { type: mime }) });
      report.imported++;
    } catch (err) {
      report.skipped.push(`${s.colour} (${err instanceof Error ? err.message : "erreur"})`);
    }
  }
  return report;
}
