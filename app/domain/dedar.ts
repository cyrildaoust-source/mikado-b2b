/*
 * Tissus Dedar (dedar.com) : coloris lus sur la fiche publique d'un produit.
 * Chaque coloris y est une vignette « bc-swatch » de cdn.dedar.com dont le
 * texte alternatif donne le nom et le numéro (« Acacia 012 »). Import voulu
 * par Cyril le 26/11/2026 (« un maximum de tissus »).
 */

export const DEDAR_SITE = "https://dedar.com";
export const DEDAR_SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;

export type DedarSwatch = { colour: string; name: string; src: string };

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .trim();

/** Vignettes de coloris d'une fiche : une par fichier, dans l'ordre de la page. */
export function dedarSwatches(html: string): DedarSwatch[] {
  const out: DedarSwatch[] = [];
  const seen = new Set<string>();
  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    const src = tag.match(/\bsrc="(https:\/\/cdn\.dedar\.com\/bc-swatch-\d+-[a-f0-9]+\.(?:jpe?g|png|webp))[^"]*"/i);
    const alt = tag.match(/\balt="([^"]*)"/i);
    if (!src || !alt) continue;
    const label = decode(alt[1]);
    const m = label.match(/^(.*?)\s+([0-9]{2,4}[A-Z]?)$/);
    if (!m || seen.has(src[1])) continue;
    seen.add(src[1]);
    out.push({ name: m[1].trim(), colour: m[2], src: src[1] });
  }
  return out;
}

/** Nom de la collection : le nom le plus fréquent des vignettes, sinon le titre tiré du slug. */
export function dedarCollection(swatches: DedarSwatch[], slug: string) {
  const counts = new Map<string, number>();
  for (const s of swatches) counts.set(s.name, (counts.get(s.name) || 0) + 1);
  const best = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  return best || slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** Fiches produit listées par le plan du site (products.xml). */
export function dedarProductSlugs(xml: string) {
  const slugs = new Set<string>();
  for (const m of xml.matchAll(/<loc>https:\/\/dedar\.com\/products\/([a-z0-9-]+)\/?<\/loc>/g)) slugs.add(m[1]);
  return [...slugs];
}
