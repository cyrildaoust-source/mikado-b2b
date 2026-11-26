// Modèles 3D d'une fiche, pour les plans des architectes.
//
// Deux sources, dans cet ordre :
// 1. le métachamp produit `custom.models_3d` (JSON) posé par l'importateur, avec les
//    fichiers propres au produit : { "files": [{ "format": "DWG", "url": "https://…" }],
//    "page": "https://…" } ; `page` est la page de téléchargement de la marque pour ce
//    produit, quand les fichiers n'ont pas d'adresse directe ;
// 2. à défaut, la bibliothèque 3D de la marque (BRAND_LIBRARIES), où l'architecte
//    cherche le produit lui-même.
// Aucune adresse n'est devinée : une marque sans source vérifiée n'a pas d'entrée.

import type { RawMetafield } from "./specs";

export type ModelFile = { format: string; url: string };
export type ModelAccess = "public" | "free_account" | "dealer_login";
export type BrandLibrary = {
  url: string;
  access: ModelAccess;
  formats: string[];
};
export type Models3d = {
  files: ModelFile[];
  /** Page de téléchargement de la marque pour ce produit. */
  page?: string;
  /** Bibliothèque de la marque, quand la fiche n'a ni fichier ni page. */
  library?: BrandLibrary & { vendor: string };
};

export const MODELS_3D_KEY = { namespace: "custom", key: "models_3d" } as const;

/** Bibliothèques 3D par marque, relevées le 26/11/2026 (confiance moyenne ou haute).
 * Relevé complet : /mnt/project-files/modeles-3d/sources/ du projet. */
export const BRAND_LIBRARIES: Record<string, BrandLibrary> = {
  Flos: {
    url: "https://professional.flos.com/en/global/product-downloads/planning-aids/",
    access: "public",
    formats: ["2D", "3D", "LDT"],
  },
  Artemide: {
    url: "https://artemide.com/en/download",
    access: "public",
    formats: ["DWG", "DXF", "3DS", "STP", "IES"],
  },
  "Martinelli Luce": {
    url: "https://martinelliluce.it/en/pCon",
    access: "public",
    formats: ["3D", "pCon"],
  },
  "Louis Poulsen": {
    url: "https://www.louispoulsen.com/en/download-center",
    access: "public",
    formats: ["Revit", "DXF", "FBX", "IFC", "LDT"],
  },
  Muuto: {
    url: "https://download.muuto.com/digitalshowroom/#/gallery/2D%252C-3D-%2526-revit-files",
    access: "public",
    formats: ["DWG", "3DS", "OBJ", "SKP", "RFA"],
  },
  Fatboy: {
    url: "https://business.fatboy.com/productinformation/productinformation_7.3dfiles",
    access: "public",
    formats: [],
  },
  Knoll: {
    url: "https://www.knoll.com/design-plan/resources/furniture-symbols/showcase-symbols",
    access: "public",
    formats: ["RFA", "DWG", "SKP"],
  },
  HAY: {
    url: "https://www.hay.com/professionals/planning",
    access: "public",
    formats: ["pCon"],
  },
  Softline: {
    url: "https://softline.presscloud.com/digitalshowroom/#/gallery/3D-files",
    access: "public",
    formats: [],
  },
  Ethnicraft: {
    url: "https://sheprd.app/ethnicraft",
    access: "dealer_login",
    formats: ["DWG", "SKP"],
  },
};

const httpsUrl = (v: unknown) => {
  if (typeof v !== "string") return "";
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:" ? u.toString() : "";
  } catch {
    return "";
  }
};

const FORMAT = /^[A-Za-z0-9 .+/-]{1,24}$/;

/** Lit `custom.models_3d`. Une valeur mal formée ne casse pas la fiche : elle est ignorée. */
export function parseModels3d(raw: string | null | undefined): Omit<Models3d, "library"> {
  if (!raw) return { files: [] };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { files: [] };
  }
  const obj = (Array.isArray(data) ? { files: data } : data) as {
    files?: unknown;
    page?: unknown;
  } | null;
  if (!obj || typeof obj !== "object") return { files: [] };
  const seen = new Set<string>();
  const files: ModelFile[] = [];
  for (const f of Array.isArray(obj.files) ? obj.files : []) {
    const url = httpsUrl((f as { url?: unknown })?.url);
    const format = String((f as { format?: unknown })?.format ?? "").trim();
    if (!url || !FORMAT.test(format) || seen.has(url)) continue;
    seen.add(url);
    files.push({ format: format.toUpperCase(), url });
  }
  const page = httpsUrl(obj.page);
  return page ? { files, page } : { files };
}

/** Modèles 3D d'une fiche : ses fichiers, sinon sa page marque, sinon la bibliothèque. */
export function productModels3d(
  fields: RawMetafield[],
  vendor: string,
  libraries: Record<string, BrandLibrary> = BRAND_LIBRARIES,
): Models3d | null {
  const field = fields.find(
    (m) => m.namespace === MODELS_3D_KEY.namespace && m.key === MODELS_3D_KEY.key,
  );
  const own = parseModels3d(field?.value);
  if (own.files.length || own.page) return own;
  const library = libraries[vendor];
  return library ? { files: [], library: { ...library, vendor } } : null;
}

export const ACCESS_NOTE: Record<ModelAccess, string> = {
  public: "Téléchargement libre sur le site de la marque.",
  free_account: "La marque demande un compte gratuit.",
  dealer_login: "Espace réservé aux revendeurs.",
};
