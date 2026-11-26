import db from "../db.server";
import { LIBRARY_MAX_BYTES, type LibraryEntry } from "../domain/library";
import { imageSize } from "./moodboard.server";

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
