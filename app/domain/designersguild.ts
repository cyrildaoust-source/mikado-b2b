/*
 * Designers Guild (designersguild.com) : la page /fabric (et /wallpaper)
 * liste tout le catalogue en cartes « nom du coloris + référence FDG3301/03 ».
 * Import voulu par Cyril le 26/11/2026 (« un maximum de tissus »).
 */

export const DG_SITE = "https://www.designersguild.com";
export const DG_KINDS = ["fabric", "wallpaper"] as const;
export type DgKind = (typeof DG_KINDS)[number];
export const DG_IMAGE = /^https:\/\/www\.designersguild\.com\/assets\/img\/(?:fabric|wallpaper)\/\d{1,9}\.(?:webp|jpe?g|png)$/;

export type DgCard = { name: string; reference: string; image: string };
export type DgColour = { collection: string; colour: string; image: string };

const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** Cartes de la page catalogue. */
export function dgCards(html: string): DgCard[] {
  const out: DgCard[] = [];
  for (const li of html.split(/<li class="card"/).slice(1)) {
    const img = li.match(/<img[^>]*\bsrc="(?:\/|https:\/\/www\.designersguild\.com\/)?(assets\/img\/(?:fabric|wallpaper)\/\d{1,9}\.(?:webp|jpe?g|png))"/i);
    const name = li.match(/<h3>([^<]+)<\/h3>/);
    const ref = li.match(/<p class="meta">([^<]+)<\/p>/);
    if (!img || !name) continue;
    out.push({ name: decode(name[1]), reference: ref ? decode(ref[1]) : "", image: `${DG_SITE}/${img[1]}` });
  }
  return out;
}

/**
 * Collection et coloris : les cartes d'une même référence de dessin
 * (FDG3301/…) partagent le début de leur nom, le reste est la teinte.
 */
export function dgColours(cards: DgCard[]): DgColour[] {
  const groups = new Map<string, DgCard[]>();
  for (const c of cards) {
    const key = c.reference.split("/")[0] || c.name;
    groups.set(key, [...(groups.get(key) || []), c]);
  }
  const out: DgColour[] = [];
  for (const group of groups.values()) {
    const words = group.map((c) => c.name.split(" "));
    let n = Math.min(...words.map((w) => w.length));
    if (group.length === 1) n = Math.max(1, words[0].length - 1);
    else while (n > 0 && !words.every((w) => w.slice(0, n).join(" ") === words[0].slice(0, n).join(" "))) n--;
    // Au moins un mot pour la teinte.
    for (const [i, c] of group.entries()) {
      const k = Math.min(Math.max(n, 1), words[i].length - 1) || words[i].length;
      const collection = words[i].slice(0, k).join(" ");
      const tint = words[i].slice(k).join(" ");
      const num = c.reference.split("/")[1] || "";
      out.push({ collection, colour: [num, tint].filter(Boolean).join(" "), image: c.image });
    }
  }
  return out;
}
