/*
 * Tissus Rubelli (rubelli.com) : la liste « textiles » donne les fiches, et
 * chaque fiche montre ses coloris en vignettes cdn.rubelli.com dont le dossier
 * porte le numéro (A762_001) et le texte alternatif le nom (« Ombra - Celeste »).
 * Import voulu par Cyril le 26/11/2026 (« un maximum de tissus »).
 */

export const RUBELLI_SITE = "https://www.rubelli.com";
export const RUBELLI_SLUG = /^[a-z0-9][a-z0-9-]{0,80}-\d{4,6}$/;
/** Photo d'un coloris en 840 px, seule forme admise en bibliothèque. */
export const RUBELLI_IMAGE = /^https:\/\/cdn\.rubelli\.com\/A\d{2,6}_\d{3}\/\d{2,6}_\d{1,3}\.840x840c\.jpg$/;

export type RubelliColour = { collection: string; colour: string; image: string };

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;|&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

/** Fiches d'une page de la liste, dans l'ordre, sans doublon. */
export function rubelliListing(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/href="https:\/\/www\.rubelli\.com\/en\/([a-z0-9-]+-\d{4,6})\/?"/g)) out.add(m[1]);
  return [...out];
}

/** Coloris d'une fiche : un par numéro, avec la photo en 840 px. */
export function rubelliColours(html: string): RubelliColour[] {
  const out: RubelliColour[] = [];
  const seen = new Set<string>();
  const tags = html.match(/<img\b[^>]*>/gi) || [];
  // Les vignettes nommées (« Ombra - Celeste ») passent avant la grande photo sans nom.
  const named = tags.filter((t) => /\balt="[^"]* - [^"]*"/i.test(t));
  for (const tag of named.length ? named : tags) {
    const src = tag.match(/\b(?:data-)?src="https:\/\/cdn\.rubelli\.com\/A(\d{2,6})_(\d{3})\/\1_(\d{1,3})\.\d+x\d+c\.jpg"/i);
    const alt = tag.match(/\balt="([^"]*)"/i);
    if (!src || !alt) continue;
    const [, code, padded, num] = src;
    if (seen.has(padded)) continue;
    const label = decode(alt[1]);
    const dash = label.lastIndexOf(" - ");
    const collection = dash > 0 ? label.slice(0, dash).trim() : label;
    const tint = dash > 0 ? label.slice(dash + 3).trim() : "";
    if (!collection) continue;
    seen.add(padded);
    out.push({
      collection,
      colour: tint ? `${Number(num)} ${tint}` : String(Number(num)),
      image: `https://cdn.rubelli.com/A${code}_${padded}/${code}_${num}.840x840c.jpg`,
    });
  }
  return out;
}

/** Fiche remplacée par une autre (« Replaced by 30253 ») : on la laisse de côté. */
export const rubelliReplaced = (html: string) => /<title>[^<]*Replaced by/i.test(html);
