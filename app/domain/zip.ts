/*
 * Lecture d'une archive zip dans le navigateur (et dans les tests) : les
 * photos d'un pack d'images d'éditeur. Archives classiques seulement
 * (stockées ou « deflate »), sans chiffrement ni zip64.
 */

export type ZipEntry = { name: string; method: number; compressed: number; size: number; offset: number };

const IMAGE = /\.(jpe?g|png|webp)$/i;

export function listZip(buf: ArrayBuffer): ZipEntry[] {
  const v = new DataView(buf);
  // Fin du répertoire central : signature 0x06054b50, cherchée depuis la fin.
  let end = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--)
    if (v.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw Error("Ce fichier n'est pas une archive zip lisible.");
  const count = v.getUint16(end + 10, true);
  let p = v.getUint32(end + 16, true);
  const entries: ZipEntry[] = [];
  const utf8 = new TextDecoder("utf-8"),
    latin = new TextDecoder("latin1");
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw Error("Archive zip abîmée.");
    const flags = v.getUint16(p + 8, true),
      method = v.getUint16(p + 10, true),
      compressed = v.getUint32(p + 20, true),
      size = v.getUint32(p + 24, true),
      nameLen = v.getUint16(p + 28, true),
      extraLen = v.getUint16(p + 30, true),
      commentLen = v.getUint16(p + 32, true),
      offset = v.getUint32(p + 42, true);
    const raw = new Uint8Array(buf, p + 46, nameLen);
    const name = (flags & 0x800 ? utf8 : latin).decode(raw);
    if (!(flags & 1)) entries.push({ name, method, compressed, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Photos de l'archive, hors dossiers système (__MACOSX, fichiers cachés). */
export function zipImages(entries: ZipEntry[]) {
  return entries.filter((e) => {
    const base = e.name.split("/").pop() || "";
    return IMAGE.test(base) && !base.startsWith(".") && !e.name.includes("__MACOSX") && e.size > 0;
  });
}

export async function readZipEntry(buf: ArrayBuffer, e: ZipEntry): Promise<Uint8Array<ArrayBuffer>> {
  const v = new DataView(buf);
  if (v.getUint32(e.offset, true) !== 0x04034b50) throw Error("Archive zip abîmée.");
  const start = e.offset + 30 + v.getUint16(e.offset + 26, true) + v.getUint16(e.offset + 28, true);
  // Tailles prises dans le répertoire central : l'en-tête local peut les omettre.
  const slice = new Uint8Array(buf, start, Math.min(e.compressed, buf.byteLength - start));
  if (e.method === 0) return slice.slice(0, e.size);
  if (e.method !== 8) throw Error("Compression non prise en charge.");
  const stream = new Blob([slice]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function mimeOf(name: string) {
  return /\.png$/i.test(name) ? "image/png" : /\.webp$/i.test(name) ? "image/webp" : "image/jpeg";
}
