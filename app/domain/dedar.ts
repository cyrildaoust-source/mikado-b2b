/*
 * Tissus Dedar (dedar.com) : coloris lus sur la fiche publique d'un produit.
 * Chaque coloris y est une vignette « bc-swatch » de cdn.dedar.com dont le
 * texte alternatif donne le nom et le numéro (« Acacia 012 »). Import voulu
 * par Cyril le 26/11/2026 (« un maximum de tissus »).
 */

export const DEDAR_SITE = "https://dedar.com";
export const DEDAR_SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;

export type DedarSwatch = {
  colour: string;
  name: string;
  /** Vignette 150 px (bc-swatch). */
  src: string;
  /** Photo du coloris en grand (bc-variant), quand la fiche en donne une. */
  image?: string;
  /** Nom de teinte donné par Dedar (« rose indien »). */
  tint?: string;
};

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

// ——— Données Nuxt de la page (__NUXT_DATA__) ———
// La page n'affiche que quelques vignettes ; les autres coloris sont dans la
// charge utile Nuxt, un tableau aplati où chaque valeur renvoie aux autres par
// leur indice (format « devalue »).

const TAGS = new Set(["Reactive", "ShallowReactive", "Ref", "ShallowRef", "NuxtError", "EmptyRef", "EmptyShallowRef"]);

/** Reconstruit l'arbre d'une charge devalue. Les cycles sont coupés. */
export function unflattenPayload(flat: unknown[]): unknown {
  const memo = new Map<number, unknown>();
  const busy = new Set<number>();
  const at = (i: unknown): unknown => {
    if (typeof i !== "number" || i < 0 || i >= flat.length) return undefined;
    if (memo.has(i)) return memo.get(i);
    if (busy.has(i)) return undefined;
    busy.add(i);
    const v = flat[i];
    let out: unknown = v;
    if (Array.isArray(v)) {
      if (typeof v[0] === "string") {
        out = TAGS.has(v[0]) ? at(v[1]) : v[0] === "Set" ? v.slice(1).map(at) : v[0] === "Date" ? v[1] : undefined;
      } else out = v.map(at);
    } else if (v && typeof v === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, idx] of Object.entries(v)) o[k] = at(idx);
      out = o;
    }
    busy.delete(i);
    memo.set(i, out);
    return out;
  };
  return at(0);
}

const SWATCH_URL = /^https:\/\/cdn\.dedar\.com\/bc-swatch-\d+-[a-f0-9]+\.(?:jpe?g|png|webp)/i;
const LABEL = /^(.*?\S)\s+([0-9]{2,4}[A-Z]?)$/;
const CODE = /^[0-9]{2,4}[A-Z]?$/;
const CODE_KEYS = /^(code|colou?r|colou?r_?code|colou?rway|variant_?code|number|num|sku)$/i;

type Node = Record<string, unknown>;
const isObj = (v: unknown): v is Node => !!v && typeof v === "object" && !Array.isArray(v);

/** Nom et numéro portés directement par un objet (« Acacia 012 », ou un champ code). */
function labelOf(o: Node): { name: string; colour: string } | null {
  let name = "";
  let colour = "";
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "string") {
      const m = decode(v).match(LABEL);
      if (m && !/^bc /i.test(m[1]) && !/swatch/i.test(m[1])) return { name: m[1].trim(), colour: m[2] };
      if (CODE_KEYS.test(k) && CODE.test(v.trim())) colour = v.trim();
      if (/^(name|title|product_?name)$/i.test(k) && !/swatch/i.test(v)) name ||= decode(v);
    }
  }
  return colour ? { name, colour } : null;
}

/** Coloris trouvés dans la charge Nuxt : chaque vignette prend le nom du plus proche objet parent qui en porte un. */
export function dedarPayloadSwatches(html: string): DedarSwatch[] {
  const script = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!script) return [];
  let flat: unknown;
  try {
    flat = JSON.parse(script[1]);
  } catch {
    return [];
  }
  if (!Array.isArray(flat)) return [];
  const out: DedarSwatch[] = [];
  const seen = new Set<string>();
  const seenNodes = new Set<unknown>();
  const walk = (v: unknown, stack: Node[]) => {
    if (typeof v === "string") {
      const src = v.match(SWATCH_URL)?.[0];
      if (!src || seen.has(src)) return;
      for (let i = stack.length - 1; i >= Math.max(0, stack.length - 4); i--) {
        const l = labelOf(stack[i]);
        if (l) {
          seen.add(src);
          out.push({ name: l.name, colour: l.colour, src });
          return;
        }
      }
      return;
    }
    if (!v || typeof v !== "object" || seenNodes.has(v)) return;
    seenNodes.add(v);
    if (Array.isArray(v)) for (const x of v) walk(x, stack);
    else for (const x of Object.values(v)) walk(x, [...stack, v as Node]);
  };
  walk(unflattenPayload(flat), []);
  return out;
}

/** Vignettes de la page puis celles de la charge Nuxt, sans doublon de fichier ni de numéro. */
export function dedarAllSwatches(html: string, slug = ""): DedarSwatch[] {
  const variants = slug ? dedarVariants(html, slug) : [];
  if (variants.length) {
    // Les vignettes de la page que la charge n'aurait pas complètent la liste.
    const codes = new Set(variants.map((v) => v.colour));
    return [...variants, ...dedarSwatches(html).filter((s) => !codes.has(s.colour))];
  }
  const out = dedarSwatches(html);
  const extra = dedarPayloadSwatches(html);
  // Les fiches liées (« vous aimerez aussi ») sont aussi dans la charge : on ne garde que la collection de la page.
  const name = dedarCollection(out.length ? out : extra, "").toLowerCase();
  const files = new Set(out.map((s) => s.src));
  const codes = new Set(out.map((s) => s.colour));
  for (const s of extra) {
    if (files.has(s.src) || codes.has(s.colour)) continue;
    if (s.name && name && s.name.toLowerCase() !== name) continue;
    files.add(s.src);
    codes.add(s.colour);
    out.push({ ...s, name: s.name || out[0]?.name || "" });
  }
  return out;
}

/** Diagnostic : la chaîne de parents d'une vignette, valeurs simples seulement. */
export function dedarPayloadTrace(html: string, id: string) {
  const script = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!script) return null;
  const root = unflattenPayload(JSON.parse(script[1]));
  const seenNodes = new Set<unknown>();
  let found: Node[] | null = null;
  const walk = (v: unknown, stack: Node[]) => {
    if (found) return;
    if (typeof v === "string") {
      if (v.includes(id) && SWATCH_URL.test(v)) found = stack;
      return;
    }
    if (!v || typeof v !== "object" || seenNodes.has(v)) return;
    seenNodes.add(v);
    if (Array.isArray(v)) for (const x of v) walk(x, stack);
    else for (const x of Object.values(v)) walk(x, [...stack, v as Node]);
  };
  walk(root, []);
  const chain = (found || []) as Node[];
  return chain.slice(-5).map((o) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "object" ? (Array.isArray(v) ? `[${v.length}]` : "{…}") : String(v).slice(0, 80)])),
  );
}

const VARIANT_URL = /^https:\/\/cdn\.dedar\.com\/bc-variant-\d+-[a-f0-9]+\.(?:jpe?g|png|webp)/i;

/** Toutes les chaînes d'un sous-arbre (profondeur bornée). */
function strings(v: unknown, out: string[] = [], depth = 0, seen = new Set<unknown>()): string[] {
  if (typeof v === "string") out.push(v);
  else if (v && typeof v === "object" && depth < 6 && !seen.has(v)) {
    seen.add(v);
    for (const x of Array.isArray(v) ? v : Object.values(v)) strings(x, out, depth + 1, seen);
  }
  return out;
}

/**
 * Coloris de la fiche d'après la charge Nuxt : chaque variante du produit dont
 * le slug est celui de la page porte un code (« 012 »), une teinte, une
 * vignette et des photos en grand.
 */
export function dedarVariants(html: string, slug: string): DedarSwatch[] {
  const script = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!script) return [];
  let root: unknown;
  try {
    root = unflattenPayload(JSON.parse(script[1]));
  } catch {
    return [];
  }
  const seen = new Set<unknown>();
  let product: Node | null = null;
  const find = (v: unknown) => {
    if (product || !v || typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    if (isObj(v) && v.slug === slug && Array.isArray(v.variants) && v.variants.length) product = v;
    for (const x of Array.isArray(v) ? v : Object.values(v)) find(x);
  };
  find(root);
  if (!product) return [];
  const p = product as Node;
  const name = typeof p.title === "string" ? decode(p.title) : "";
  const out: DedarSwatch[] = [];
  const codes = new Set<string>();
  for (const v of p.variants as unknown[]) {
    if (!isObj(v) || typeof v.code !== "string" || !CODE.test(v.code.trim())) continue;
    const code = v.code.trim();
    const all = strings(v);
    const src = all.map((x) => x.match(SWATCH_URL)?.[0]).find(Boolean);
    const image = all.map((x) => x.match(VARIANT_URL)?.[0]).find(Boolean);
    if ((!src && !image) || codes.has(code)) continue;
    codes.add(code);
    const tint = typeof v.color === "string" ? decode(v.color) : "";
    out.push({ name, colour: code, src: src || image!, ...(image ? { image } : {}), ...(tint ? { tint } : {}) });
  }
  return out;
}
