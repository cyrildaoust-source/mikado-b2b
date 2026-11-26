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
