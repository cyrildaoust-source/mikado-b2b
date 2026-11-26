import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import inter400 from "../../public/fonts/inter-400.woff2?inline";
import db from "../db.server";
import { quoteSchema, quoteSections, type QuoteState } from "../domain/quote";
import {
  BOARD_RATIO,
  TEXT_STYLES,
  WHOLE_PROJECT,
  moodSchema,
  sized,
  isDark,
  materialCaption,
  type Board,
  type BoardSection,
  type MoodState,
  type PaletteItem,
} from "../domain/moodboard";
import { BoardView } from "../components/moodboard/BoardView";
import { TEXTURE_SOURCE } from "../domain/materials";
import { LIBRARY_SOURCE } from "../domain/library";
import { demoProducts } from "./catalog.server";
import { gql, type Admin } from "./shopify-api.server";
import { launchBrowser } from "./pdf.server";

/** Taille maximale d'une photo ajoutée, après redimensionnement dans le navigateur. */
export const MAX_UPLOAD = 3_000_000;
export const MAX_UPLOADS = 60;
const MIMES = ["image/jpeg", "image/png", "image/webp"];

export async function getMood(quoteId: number): Promise<MoodState> {
  const row = await db.moodBoard.findUnique({ where: { quoteId } });
  if (!row) return { boards: [] };
  const parsed = moodSchema.safeParse(JSON.parse(row.state));
  return parsed.success ? parsed.data : { boards: [] };
}

export async function saveMood(quoteId: number, raw: unknown) {
  const state = moodSchema.parse(raw);
  // Une photo ajoutée doit appartenir à ce devis.
  const uploads = new Set(
    (
      await db.moodImage.findMany({ where: { quoteId }, select: { id: true } })
    ).map((i) => i.id),
  );
  for (const b of state.boards)
    for (const i of b.items)
      if ((i.kind === "photo" || i.kind === "material") && i.src.startsWith("upload:") && !uploads.has(i.src.slice(7)))
        throw Error("Une photo ajoutée n'est plus disponible.");
  const json = JSON.stringify(state);
  await db.moodBoard.upsert({
    where: { quoteId },
    create: { quoteId, state: json },
    update: { state: json },
  });
}

export async function listUploads(quoteId: number) {
  return db.moodImage.findMany({
    where: { quoteId },
    select: { id: true, name: true, width: true, height: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function addUpload(quoteId: number, file: File) {
  if (!MIMES.includes(file.type)) throw Error("Format accepté : JPEG, PNG ou WebP.");
  if (file.size > MAX_UPLOAD) throw Error("Photo trop lourde (3 Mo au plus).");
  if ((await db.moodImage.count({ where: { quoteId } })) >= MAX_UPLOADS)
    throw Error(`${MAX_UPLOADS} photos ajoutées au plus par devis.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const size = imageSize(bytes, file.type);
  if (!size) throw Error("Photo illisible.");
  return db.moodImage.create({
    data: {
      quoteId,
      mime: file.type,
      data: bytes,
      width: size.width,
      height: size.height,
      name: file.name.slice(0, 200),
    },
    select: { id: true, name: true, width: true, height: true },
  });
}

export async function deleteUpload(quoteId: number, id: string) {
  await db.moodImage.deleteMany({ where: { quoteId, id } });
  // Les planches ne gardent pas une photo supprimée.
  const mood = await getMood(quoteId);
  const src = `upload:${id}`;
  const uses = (i: (typeof mood.boards)[number]["items"][number]) =>
    (i.kind === "photo" || i.kind === "material") && i.src === src;
  if (mood.boards.some((b) => b.items.some(uses)))
    await saveMood(quoteId, {
      boards: mood.boards.map((b) => ({
        ...b,
        items: b.items.filter((i) => !uses(i)),
      })),
    });
}

export async function getUpload(quoteId: number, id: string) {
  return db.moodImage.findFirst({ where: { quoteId, id } });
}

/** Dimensions lues dans l'en-tête du fichier (JPEG, PNG, WebP). */
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

type Swatch = { name: string; image: string; color: string; maker: string };

/** Photos d'ambiance et pastilles de finition (tissus, bois…) des produits du devis, par variante. */
async function productPhotos(admin: Admin | null, variantIds: string[]) {
  const out = new Map<string, { photos: { url: string; alt: string }[]; swatches: Swatch[] }>();
  if (!variantIds.length) return out;
  if (!admin) {
    // Démonstration : les finitions deviennent des pastilles de couleur.
    const tones = ["#b9a68a", "#6f7d72", "#3e4247", "#c8b9a6"];
    for (const p of demoProducts)
      for (const v of p.productVariants)
        if (variantIds.includes(v.id))
          out.set(v.id, {
            photos: p.images,
            swatches: p.productVariants.map((x, n) => ({
              name: `${p.title}, ${x.title}`,
              image: "",
              color: tones[n % tones.length],
              maker: p.vendor,
            })),
          });
    return out;
  }
  for (let start = 0; start < variantIds.length; start += 100) {
    const data = await gql<{
      nodes: ({
        id: string;
        product: {
          title: string;
          vendor: string;
          media: { nodes: { image?: { url: string; altText: string | null } | null }[] };
          options: {
            name: string;
            optionValues: {
              name: string;
              swatch: { color: string | null; image: { image: { url: string } | null } | null } | null;
            }[];
          }[];
        };
      } | null)[];
    }>(
      admin,
      `query MoodPhotos($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant { id product { title vendor media(first: 10) { nodes { ... on MediaImage { image { url altText } } } } options { name optionValues { name swatch { color image { image { url } } } } } } } } }`,
      { ids: variantIds.slice(start, start + 100) },
    ).catch(() => ({ nodes: [] }));
    for (const n of data.nodes)
      if (n?.product)
        out.set(n.id, {
          photos: n.product.media.nodes
            .filter((m) => m.image?.url)
            .map((m) => ({ url: m.image!.url, alt: m.image!.altText || n.product.title })),
          swatches: n.product.options.flatMap((o) =>
            o.optionValues
              .filter((v) => v.swatch?.image?.image?.url || v.swatch?.color)
              .map((v) => ({
                name: v.name,
                image: v.swatch?.image?.image?.url || "",
                color: /^#[0-9a-f]{6}$/i.test(v.swatch?.color || "") ? v.swatch!.color! : "",
                maker: n.product.vendor,
              }))
              .filter((v) => v.image || v.color),
          ),
        });
  }
  return out;
}

const sameImage = (a: string, b: string) => a.split("?")[0] === b.split("?")[0];

/** Pièces du devis et photos proposées pour chacune. */
export async function boardSections(
  state: QuoteState,
  admin: Admin | null,
): Promise<BoardSection[]> {
  const sections = quoteSections(state);
  const variantIds = [
    ...new Set(
      state.groups
        .flatMap((g) => g.items)
        .concat(state.extras)
        .map((l) => l.variantId)
        .filter((id): id is string => !!id),
    ),
  ];
  const ambiance = await productPhotos(admin, variantIds);
  const result = sections.map((section) => {
    const photos: PaletteItem[] = [];
    const add = (p: PaletteItem) => {
      if (p.src && !photos.some((x) => sameImage(x.src, p.src))) photos.push(p);
    };
    const groupIds = new Set(section.groups.map((g) => g.id));
    const lines = section.groups.flatMap((g) =>
      g.items.map((i) => ({ line: i, tag: (i.id === g.selected ? "produit" : "alternative") as PaletteItem["tag"] })),
    );
    for (const e of state.extras)
      if (e.parent && groupIds.has(e.parent)) lines.push({ line: e, tag: "option" });
    for (const { line, tag } of lines) add({ src: line.image, alt: line.name, tag });
    for (const { line } of lines)
      for (const a of (line.variantId && ambiance.get(line.variantId)?.photos) || [])
        add({ src: a.url, alt: a.alt, tag: "ambiance" });
    const finishes: PaletteItem[] = [];
    for (const { line } of lines)
      for (const f of (line.variantId && ambiance.get(line.variantId)?.swatches) || [])
        if (!finishes.some((x) => x.alt === f.name && x.maker === f.maker))
          finishes.push({ src: f.image, alt: f.name, tag: "finition", maker: f.maker, color: f.color || undefined });
    return { key: section.id, title: section.title, photos, finishes: finishes.slice(0, 40) };
  });
  if (result.length > 1)
    result.unshift({
      key: WHOLE_PROJECT,
      title: "Tout le projet",
      photos: result.flatMap((s) => s.photos).filter(
        (p, i, all) => all.findIndex((x) => sameImage(x.src, p.src)) === i,
      ),
      finishes: result
        .flatMap((s) => s.finishes)
        .filter((f, i, all) => all.findIndex((x) => x.alt === f.alt && x.maker === f.maker) === i)
        .slice(0, 40),
    });
  return result;
}

export async function quoteState(quoteState: string) {
  return quoteSchema.parse(JSON.parse(quoteState));
}

// ——— Exports ———

/** Photo en données intégrées : Shopify, texture CC0, démo, photo ajoutée ou bibliothèque Mikado. */
async function embed(quoteId: number, src: string, width: number) {
  if (src.startsWith("data:image/svg+xml")) {
    const svg = src.includes(";base64,")
      ? Buffer.from(src.split(",")[1], "base64")
      : Buffer.from(decodeURIComponent(src.slice(src.indexOf(",") + 1)));
    return { mime: "image/svg+xml", data: svg };
  }
  if (src.startsWith("upload:")) {
    const img = await getUpload(quoteId, src.slice(7));
    return img ? { mime: img.mime, data: Buffer.from(img.data) } : null;
  }
  if (LIBRARY_SOURCE.test(src)) {
    const img = await db.libraryMaterial.findUnique({
      where: { id: src.slice(8) },
      select: { mime: true, data: true },
    });
    return img ? { mime: img.mime, data: Buffer.from(img.data) } : null;
  }
  // Hôtes admis : le CDN Shopify et les textures CC0 de Poly Haven.
  const u = new URL(TEXTURE_SOURCE.test(src) ? src : sized(src, width));
  if (u.protocol !== "https:" || !(u.hostname === "cdn.shopify.com" || TEXTURE_SOURCE.test(src))) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const r = await fetch(u, { signal: controller.signal });
    const mime = r.headers.get("content-type")?.split(";")[0] || "";
    if (!r.ok || !mime.startsWith("image/")) return null;
    const data = Buffer.from(await r.arrayBuffer());
    return data.length > 20_000_000 ? null : { mime, data };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function embedAll(quoteId: number, boards: Board[], width: number) {
  const srcs = [
    ...new Set(boards.flatMap((b) => b.items.flatMap((i) => (i.kind === "photo" || i.kind === "material" ? [i.src] : [])))),
  ];
  const out = new Map<string, { mime: string; data: Buffer }>();
  // Six téléchargements à la fois.
  for (let start = 0; start < srcs.length; start += 6)
    await Promise.all(
      srcs.slice(start, start + 6).map(async (src) => {
        const e = await embed(quoteId, src, width);
        if (e) out.set(src, e);
      }),
    );
  return out;
}

const dataUrl = (e: { mime: string; data: Buffer }) =>
  `data:${e.mime};base64,${e.data.toString("base64")}`;

const FONT_CSS = `@font-face{font-family:"Inter";font-weight:400;src:url(${inter400}) format("woff2")}`;

/** Planches en HTML autonome, une par page de 1920 × 1080. */
async function boardsHtml(quoteId: number, boards: Board[]) {
  const images = await embedAll(quoteId, boards, 2400);
  const markup = boards
    .map((board) =>
      renderToStaticMarkup(
        createElement(
          "section",
          { className: "page" },
          createElement(BoardView, {
            board,
            resolve: (src) => {
              const e = images.get(src);
              return e ? dataUrl(e) : "";
            },
            font: "Inter, Arial, sans-serif",
          }),
        ),
      ),
    )
    .join("");
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>${FONT_CSS}
@page{size:1920px 1080px;margin:0}
*{box-sizing:border-box}html,body{margin:0;padding:0}
.page{width:1920px;height:1080px;overflow:hidden;break-after:page}
.page:last-child{break-after:auto}
</style></head><body>${markup}</body></html>`;
}

async function withPage<T>(html: string, fn: (page: import("playwright").Page) => Promise<T>, scale = 1) {
  const browser = await launchBrowser();
  const deadline = setTimeout(() => void browser.close().catch(() => {}), 50000);
  try {
    const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: scale,
    });
    // Tout est intégré : aucune requête vers l'extérieur.
    await page.route("**/*", (route) => route.abort());
    await page.setContent(html, { waitUntil: "load", timeout: 20000 });
    await page.evaluate(() => document.fonts.ready);
    return await fn(page);
  } finally {
    clearTimeout(deadline);
    await browser.close();
  }
}

export async function moodPdf(quoteId: number, boards: Board[]) {
  const html = await boardsHtml(quoteId, boards);
  return withPage(html, (page) =>
    page.pdf({ width: "1920px", height: "1080px", printBackground: true, pageRanges: "" }),
  );
}

/** Image HD d'une planche : 3840 × 2160 pixels. */
export async function moodPng(quoteId: number, board: Board) {
  const html = await boardsHtml(quoteId, [board]);
  return withPage(
    html,
    (page) => page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 1920, height: 1080 } }),
    2,
  );
}

/** PowerPoint : une diapositive 16:9 par planche. Canva et Keynote l'ouvrent aussi. */
export async function moodPptx(
  quoteId: number,
  boards: { board: Board; title: string }[],
  project: string,
) {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13,333 × 7,5 pouces
  pptx.title = project;
  pptx.company = "Mikado Deco";
  const W = 13.333,
    H = W / BOARD_RATIO;
  const pt = (cqw: number) => Math.round(((cqw * W) / 100) * 72 * 10) / 10;
  const images = await embedAll(quoteId, boards.map((b) => b.board), 1600);
  for (const { board } of boards) {
    const slide = pptx.addSlide();
    slide.background = { color: board.background.slice(1) };
    for (const item of board.items) {
      const box = { x: item.x * W, y: item.y * H, w: item.w * W, h: item.h * H };
      if (item.kind === "photo") {
        const e = images.get(item.src);
        if (e) slide.addImage({ ...box, data: dataUrl(e), altText: item.alt });
      } else if (item.kind === "material") {
        const e = images.get(item.src);
        // Recadré en carré comme à l'écran : l'image garde ses proportions, la
        // diapositive n'en montre que le cadre.
        if (e)
          slide.addImage({
            x: box.x,
            y: box.y,
            w: item.ratio,
            h: 1,
            data: dataUrl(e),
            altText: item.name,
            sizing: { type: "cover", w: box.w, h: box.h },
          });
        const caption = materialCaption(item);
        const dark = isDark(board.background);
        const lines = [
          ...(item.name ? [{ text: item.name, options: { color: dark ? "FFFFFF" : "16181A", breakLine: !!caption } }] : []),
          ...(caption ? [{ text: caption, options: { color: dark ? "D6D3CC" : "5F5D58" } }] : []),
        ];
        if (lines.length)
          slide.addText(lines, {
            x: box.x,
            y: box.y + box.h + 0.03,
            w: Math.max(box.w, 1.9),
            h: 0.45,
            fontFace: "Inter",
            fontSize: pt(TEXT_STYLES.small.size),
            margin: 0,
            valign: "top",
          });
      } else if (item.kind === "color") {
        slide.addShape("rect", {
          ...box,
          fill: { color: item.color.slice(1) },
          line: { color: "E6E4DF", width: 0.5 },
        });
        if (item.label)
          slide.addText(item.label, {
            x: box.x,
            y: box.y + box.h + 0.03,
            w: Math.max(box.w, 1.2),
            h: 0.3,
            fontFace: "Inter",
            fontSize: pt(TEXT_STYLES.small.size),
            color: "5F5D58",
            margin: 0,
            valign: "top",
          });
      } else {
        slide.addText(item.text, {
          ...box,
          fontFace: "Inter",
          fontSize: pt(TEXT_STYLES[item.style].size),
          color: item.color.slice(1),
          align: item.align,
          valign: "top",
          margin: 0,
          lineSpacingMultiple: 1.1,
          fit: "none",
        });
      }
    }
  }
  const out = await pptx.write({ outputType: "nodebuffer" });
  return out as Buffer;
}
