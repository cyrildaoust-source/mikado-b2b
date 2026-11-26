/*
 * Bibliothèque de matières de Mikado Deco : les tissus que Cyril a en magasin
 * (Kvadrat d'abord), avec leurs photos d'échantillon fournies par l'éditeur.
 * Une matière de la bibliothèque s'écrit « library:<id> » sur la planche.
 */

export const LIBRARY_SOURCE = /^library:[a-z0-9]{10,40}$/;

/** Côté le plus long d'une photo de la bibliothèque, après redimensionnement. */
export const LIBRARY_MAX_SIDE = 1200;
export const LIBRARY_MAX_BYTES = 1_500_000;

export type LibraryEntry = {
  id: string;
  maker: string;
  collection: string;
  colour: string;
  width: number;
  height: number;
};

/**
 * Collection et coloris lus dans le nom du fichier :
 * « Hallingdal 65 - 130.jpg », « Hallingdal_65_0130.jpg », « Remix 3 0123.png ».
 * Le coloris est le dernier bloc après « - », sinon le nombre final de trois
 * ou quatre chiffres (ou de deux quand la collection en porte déjà un). Le
 * reste devient la collection.
 */
export function parseSwatchName(file: string) {
  const base = file
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/_+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const dash = base.match(/^(.+?)\s+-\s+([^-]+)$/);
  if (dash) return { collection: dash[1].trim(), colour: dash[2].trim() };
  const num = base.match(/^(.+)\s(\d{2,4})$/);
  // Un numéro de deux chiffres seul (« Hallingdal 65 ») reste dans la collection.
  if (num && (num[2].length > 2 || /\d/.test(num[1])))
    return { collection: num[1].trim(), colour: num[2] };
  return { collection: base, colour: "" };
}

/** Libellé d'une matière : « Hallingdal 65 – 130 ». */
export function libraryLabel(m: { collection: string; colour: string }) {
  return [m.collection, m.colour].filter(Boolean).join(" – ");
}

/** Matières regroupées par éditeur puis par collection, dans l'ordre alphabétique. */
export function groupLibrary<T extends LibraryEntry>(items: T[]) {
  const sorted = [...items].sort(
    (a, b) =>
      a.maker.localeCompare(b.maker, "fr") ||
      a.collection.localeCompare(b.collection, "fr", { numeric: true }) ||
      a.colour.localeCompare(b.colour, "fr", { numeric: true }),
  );
  const groups: { maker: string; items: T[] }[] = [];
  for (const m of sorted) {
    const g = groups.find((x) => x.maker === m.maker);
    if (g) g.items.push(m);
    else groups.push({ maker: m.maker, items: [m] });
  }
  return groups;
}

/** Recherche sans accents ni casse dans l'éditeur, la collection et le coloris. */
export function matchLibrary(m: LibraryEntry, query: string) {
  const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const hay = fold(`${m.maker} ${m.collection} ${m.colour}`);
  return fold(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}
