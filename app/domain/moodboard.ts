import { z } from "zod";

/*
 * Mood board d'un devis : une planche par pièce (et une pour tout le projet
 * quand il y a plusieurs pièces). La planche est au format 16:9, celui d'une
 * diapositive PowerPoint. Positions et tailles sont des fractions de la
 * planche (0 à 1) : l'écran, le PDF, l'image et le PowerPoint en découlent.
 */

/** Format de la planche : 16:9. */
export const BOARD_RATIO = 16 / 9;
/** Planche entière (toutes les pièces). */
export const WHOLE_PROJECT = "projet";

export const BACKGROUNDS = [
  { value: "#ffffff", label: "Blanc" },
  { value: "#f4f1ea", label: "Lin" },
  { value: "#e9e3d8", label: "Sable" },
  { value: "#2b2e31", label: "Anthracite" },
] as const;

export const TEXT_STYLES = {
  // Taille en pourcentage de la largeur de la planche (unité cqw à l'écran).
  title: { label: "Titre", size: 3.2, weight: 400 },
  body: { label: "Texte", size: 1.5, weight: 400 },
  small: { label: "Légende", size: 1.1, weight: 400 },
} as const;
export type TextStyle = keyof typeof TEXT_STYLES;

const fraction = z.number().min(-1).max(2);
const size = z.number().min(0.02).max(1.5);
const hex = z.string().regex(/^#[0-9a-f]{6}$/i);

/** Photo : du catalogue Shopify, de la démonstration ou ajoutée par l'architecte. */
export const photoSource = z
  .string()
  .max(200000)
  .refine(
    (s) =>
      /^https:\/\/cdn\.shopify\.com\//.test(s) ||
      /^upload:[a-z0-9]{10,40}$/.test(s) ||
      /^data:image\/svg\+xml[;,]/.test(s),
    "Photo non reconnue.",
  );

const base = {
  id: z.string().min(1).max(60),
  x: fraction,
  y: fraction,
  w: size,
  h: size,
};
export const itemSchema = z.discriminatedUnion("kind", [
  z.object({
    ...base,
    kind: z.literal("photo"),
    src: photoSource,
    /** Largeur / hauteur de la photo : le cadre garde ses proportions. */
    ratio: z.number().min(0.1).max(10),
    alt: z.string().max(250).default(""),
  }),
  z.object({
    ...base,
    kind: z.literal("text"),
    text: z.string().max(2000),
    style: z.enum(["title", "body", "small"]).default("body"),
    color: hex.default("#16181a"),
    align: z.enum(["left", "center", "right"]).default("left"),
  }),
  z.object({
    ...base,
    kind: z.literal("color"),
    color: hex,
    label: z.string().max(80).default(""),
  }),
]);
export type BoardItem = z.infer<typeof itemSchema>;
export type PhotoItem = Extract<BoardItem, { kind: "photo" }>;
export type TextItem = Extract<BoardItem, { kind: "text" }>;
export type ColorItem = Extract<BoardItem, { kind: "color" }>;

export const boardSchema = z.object({
  /** sectionId de la pièce, ou WHOLE_PROJECT. */
  key: z.string().min(1).max(100),
  background: hex.default("#ffffff"),
  // Ordre = superposition : le dernier est au premier plan.
  items: z.array(itemSchema).max(80),
});
export type Board = z.infer<typeof boardSchema>;

export const moodSchema = z.object({
  boards: z.array(boardSchema).max(201),
});
export type MoodState = z.infer<typeof moodSchema>;

/** Une photo proposée dans la colonne de gauche. */
export type PaletteItem = {
  src: string;
  alt: string;
  /** Produit du devis (« produit »), alternative, option ou photo d'ambiance. */
  tag: "produit" | "alternative" | "option" | "ambiance" | "ajout";
};

export type BoardSection = {
  key: string;
  title: string;
  photos: PaletteItem[];
};

/** Hauteur (fraction de la planche) d'une photo de largeur w et de proportion ratio. */
export function photoHeight(w: number, ratio: number) {
  return (w * BOARD_RATIO) / ratio;
}

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

/** Garde un élément dans la planche : au moins un quart visible. */
export function keepInside<T extends BoardItem>(item: T): T {
  return {
    ...item,
    x: clamp(item.x, -item.w * 0.75, 1 - item.w * 0.25),
    y: clamp(item.y, -item.h * 0.75, 1 - item.h * 0.25),
  };
}

/** Redimensionne : une photo garde ses proportions. */
export function resize<T extends BoardItem>(item: T, w: number, h: number): T {
  const width = clamp(w, 0.04, 1.2);
  if (item.kind === "photo") {
    const height = photoHeight(width, item.ratio);
    if (height > 1.2) {
      const fit = (1.2 * item.ratio) / BOARD_RATIO;
      return { ...item, w: fit, h: 1.2 };
    }
    return { ...item, w: width, h: height };
  }
  return { ...item, w: width, h: clamp(h, 0.04, 1.2) };
}

let counter = 0;
export function newId() {
  counter = (counter + 1) % 1000;
  return `m${Date.now().toString(36)}${counter.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

/**
 * Première disposition d'une planche : le titre en haut à gauche, les photos
 * en grille sous le titre, toutes visibles. La planche se modifie ensuite à la
 * main ; « Disposer automatiquement » refait cette mise en page.
 */
export function autoLayout(
  key: string,
  title: string,
  subtitle: string,
  photos: { src: string; alt: string; ratio: number }[],
  background = "#ffffff",
): Board {
  const dark = isDark(background);
  const ink = dark ? "#ffffff" : "#16181a";
  const items: BoardItem[] = [
    {
      id: newId(),
      kind: "text",
      x: 0.04,
      y: 0.05,
      w: 0.5,
      h: 0.09,
      text: title,
      style: "title",
      color: ink,
      align: "left",
    },
  ];
  if (subtitle)
    items.push({
      id: newId(),
      kind: "text",
      x: 0.04,
      y: 0.14,
      w: 0.5,
      h: 0.06,
      text: subtitle,
      style: "small",
      color: dark ? "#d6d3cc" : "#5f5d58",
      align: "left",
    });
  const list = photos.slice(0, 12);
  if (list.length) {
    // Zone des photos : sous le titre, marges de 4 %.
    const top = 0.24,
      left = 0.04,
      width = 0.92,
      height = 0.72,
      gap = 0.015;
    const cols = Math.min(
      list.length,
      list.length <= 3 ? list.length : list.length <= 8 ? 4 : 6,
    );
    const rows = Math.ceil(list.length / cols);
    const cellW = (width - gap * (cols - 1)) / cols;
    const cellH = (height - gap * BOARD_RATIO * (rows - 1)) / rows;
    list.forEach((p, i) => {
      const col = i % cols,
        row = Math.floor(i / cols);
      // La photo entre entière dans sa case, centrée.
      let w = cellW,
        h = photoHeight(w, p.ratio);
      if (h > cellH) {
        h = cellH;
        w = (h * p.ratio) / BOARD_RATIO;
      }
      items.push({
        id: newId(),
        kind: "photo",
        src: p.src,
        alt: p.alt,
        ratio: p.ratio,
        x: left + col * (cellW + gap) + (cellW - w) / 2,
        y: top + row * (cellH + gap * BOARD_RATIO) + (cellH - h) / 2,
        w,
        h,
      });
    });
  }
  return { key, background, items };
}

export function isDark(hexColor: string) {
  const n = parseInt(hexColor.slice(1), 16);
  const r = (n >> 16) & 255,
    g = (n >> 8) & 255,
    b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

/** Photo Shopify à la taille voulue (le CDN redimensionne). */
export function sized(src: string, width: number) {
  if (!/^https:\/\/cdn\.shopify\.com\//.test(src)) return src;
  try {
    const u = new URL(src);
    u.searchParams.set("width", String(width));
    return u.toString();
  } catch {
    return src;
  }
}

/** Nom de fichier sûr : « D2026-014 mood board Salon ». */
export function fileName(...parts: string[]) {
  return (
    parts
      .filter(Boolean)
      .join(" ")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^\w .-]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "mood-board"
  );
}
