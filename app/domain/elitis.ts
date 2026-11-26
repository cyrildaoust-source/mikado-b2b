/*
 * Élitis (elitis.fr) : le site lit son catalogue dans l'API Sylius publique
 * de backoffice.elitis.fr. /shop-api/taxons donne les catégories et leurs
 * collections, /shop-api/taxon-products/by-slug/<collection> les coloris.
 * Import voulu par Cyril le 26/11/2026 (« un maximum de tissus »).
 */

export const ELITIS_API = "https://backoffice.elitis.fr";
const CDN = "https://d1znk9ex7ihxii.cloudfront.net/media/cache/square_big/";
const PATH = /^[0-9a-f]{2}\/[0-9a-f]{2}\/[\w.-]{1,200}\.(?:jpe?g|png|webp)$/i;
export const ELITIS_IMAGE = /^https:\/\/d1znk9ex7ihxii\.cloudfront\.net\/media\/cache\/square_big\/[0-9a-f]{2}\/[0-9a-f]{2}\/[\w.-]{1,200}\.(?:jpe?g|png|webp)$/i;
export const ELITIS_SLUG = /^[a-z0-9][a-z0-9-]{0,120}$/;

export type ElitisCollection = { category: string; name: string; slug: string };
export type ElitisColour = { colour: string; image: string };

type Taxon = { name?: unknown; slug?: unknown; enabled?: unknown; children?: unknown };

/** Collections des catégories de matières (les accessoires sont laissés de côté). */
export function elitisCollections(tree: unknown): ElitisCollection[] {
  const out: ElitisCollection[] = [];
  const seen = new Set<string>();
  for (const top of Array.isArray(tree) ? (tree as Taxon[]) : []) {
    if (typeof top?.name !== "string" || top.slug === "accessoire" || !Array.isArray(top.children)) continue;
    for (const child of top.children as Taxon[]) {
      if (child?.enabled === false || typeof child?.name !== "string" || typeof child.slug !== "string") continue;
      if (!ELITIS_SLUG.test(child.slug) || seen.has(child.slug)) continue;
      seen.add(child.slug);
      out.push({ category: top.name.trim(), name: child.name.trim(), slug: child.slug });
    }
  }
  return out;
}

type Item = { code?: unknown; name?: unknown; images?: unknown };

/** Coloris d'une page de l'API : référence, nom et photo carrée de l'échantillon. */
export function elitisColours(page: unknown): ElitisColour[] {
  const items = (page as { items?: unknown })?.items;
  const out: ElitisColour[] = [];
  for (const it of Array.isArray(items) ? (items as Item[]) : []) {
    if (typeof it?.code !== "string" || typeof it.name !== "string") continue;
    const images = Array.isArray(it.images) ? (it.images as { code?: unknown; path?: unknown }[]) : [];
    const main = images.find((i) => i?.code === "main") ?? images[0];
    if (typeof main?.path !== "string" || !PATH.test(main.path)) continue;
    out.push({ colour: `${it.code.trim()} ${it.name.trim()}`.slice(0, 120), image: CDN + main.path });
  }
  return out;
}
