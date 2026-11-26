/** Largeur et hauteur lues dans l'en-tête d'une photo JPEG, PNG ou WebP. */
export function imageSize(b: Uint8Array, mime: string) {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    if (mime === "image/png" && b.length > 24)
      return { width: view.getUint32(16), height: view.getUint32(20) };
    if (mime === "image/webp" && b.length > 30) {
      const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (kind === "VP8X")
        return {
          width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)),
          height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)),
        };
      if (kind === "VP8 ")
        return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
      if (kind === "VP8L") {
        const bits = view.getUint32(21, true);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
    }
    if (mime === "image/jpeg") {
      let i = 2;
      while (i < b.length - 9) {
        if (b[i] !== 0xff) return null;
        const marker = b[i + 1];
        const length = view.getUint16(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
          return { height: view.getUint16(i + 5), width: view.getUint16(i + 7) };
        i += 2 + length;
      }
    }
  } catch {
    return null;
  }
  return null;
}
