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
  // Un comparateur partagé : localeCompare avec options recrée le sien à chaque appel.
  const cmp = COLLATOR.compare;
  const sorted = [...items].sort(
    (a, b) => cmp(a.maker, b.maker) || cmp(a.collection, b.collection) || cmp(a.colour, b.colour),
  );
  const byMaker = new Map<string, T[]>();
  for (const m of sorted) {
    const list = byMaker.get(m.maker);
    if (list) list.push(m);
    else byMaker.set(m.maker, [m]);
  }
  return [...byMaker].map(([maker, items]) => ({ maker, items }));
}

const COLLATOR = new Intl.Collator("fr", { numeric: true });

export function matchLibrary(m: LibraryEntry, query: string) {
  const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const hay = fold(`${m.maker} ${m.collection} ${m.colour}`);
  return fold(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

/**
 * Produit Kvadrat saisi par Cyril : son numéro, ou l'adresse de sa fiche
 * (« https://www.kvadrat.dk/en/products/upholstery/1000-hallingdal-65 »).
 * Le nom de la collection vient de l'adresse quand elle le porte.
 */
export function parseKvadratProduct(input: string) {
  const s = input.trim();
  if (/^\d{1,6}$/.test(s)) return { number: s, collection: "" };
  const slug = s.match(/\/(\d{1,6})-([a-z0-9-]+?)\/?(?:[?#].*)?$/i);
  if (slug)
    return {
      number: slug[1],
      collection: slug[2]
        .split("-")
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" "),
    };
  const bare = s.match(/\/products\/(\d{1,6})(?:[/?#]|$)/i);
  return bare ? { number: bare[1], collection: "" } : null;
}

/**
 * Coloris dans le nom d'une photo du pack Kvadrat : « _C0130_ » dans le nom
 * des packs actuels (« F_1000_C0130_W24_HIGH_CMYK.jpg »), sinon un numéro de quatre
 * chiffres commençant par 0 (« 0130 »), sinon le dernier numéro de trois ou
 * quatre chiffres autre que celui du produit. Vide quand rien ne convient :
 * Cyril le complète avant l'envoi.
 */
export function kvadratColour(file: string, product: string) {
  const base = (file.split("/").pop() || file).replace(/\.[a-z0-9]{2,5}$/i, "");
  // Pack Kvadrat : « F_1000_C0130_W24_HIGH_CMYK.jpg ».
  const tagged = base.match(/(?:^|_)C(\d{3,4})(?:_|$)/);
  if (tagged) return tagged[1];
  const groups = (base.match(/(?<!\d)\d{3,4}(?!\d)/g) || []).filter((g) => g !== product);
  return groups.find((g) => /^0\d{3}$/.test(g)) || groups.pop() || "";
}
