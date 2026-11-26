import db from "../db.server";
import { cents } from "../domain/quote";
import { gql, searchPrefix, shopInfo, type Admin } from "./shopify-api.server";
import { productSpecs, type RawMetafield, type SpecGroup } from "../domain/specs";
import { productModels3d, type Models3d } from "../domain/models3d";

// Catalogue pro : lecture côté serveur des fiches Shopify, actives et en brouillon
// (gold ou non), avec les marques que Mikado Deco masque. Rien n'est publié.

export type BrandRule = {
  vendor: string;
  visible: boolean;
};
export type CatalogCard = {
  id: string;
  numericId: string;
  title: string;
  vendor: string;
  productType: string;
  status: string;
  image: string;
  imageAlt: string;
  minPrice: number;
  maxPrice: number;
  variants: number;
  /** Fiche du catalogue = une variante : identifiant numérique et nom de finition. */
  variantNumericId?: string;
  variantTitle?: string;
};
export type CatalogVariantCard = CatalogCard & {
  variantNumericId: string;
  variantTitle: string;
};
export type CatalogVariant = {
  id: string;
  title: string;
  sku: string;
  price: number;
  options: { name: string; value: string }[];
  image: string;
};
export type CatalogProduct = CatalogCard & {
  description: string;
  /** Dimensions, matériaux et autres caractéristiques, groupées. */
  specs: SpecGroup[];
  /** Fichiers 3D pour les plans des architectes, ou la bibliothèque de la marque. */
  models3d: Models3d | null;
  images: { url: string; alt: string }[];
  options: { name: string; values: string[] }[];
  productVariants: CatalogVariant[];
};

const quoted = (v: string) => '"' + v.replace(/[\\"]/g, "\\$&") + '"';

/** Requête de recherche Shopify qui limite le catalogue à ce que Mikado Deco ouvre aux pros. */
export function visibilityQuery(rules: BrandRule[], status = "status") {
  const hidden = rules.filter((r) => !r.visible).map((r) => r.vendor);
  return `((${[`(${status}:active OR ${status}:draft)`, ...hidden.map((v) => `-vendor:${quoted(v)}`)].join(" AND ")}))`;
}

/** Familles choisies : `types` (plusieurs) et l'ancien `type` (une seule). */
export function chosenTypes(filters: { type?: string; types?: string[] }) {
  return [
    ...new Set([...(filters.types || []), filters.type || ""].filter(Boolean)),
  ];
}

/** Cartes par page : multiple de 2, 3, 4, 5 et 6 colonnes. */
export const CATALOG_PAGE = Math.min(
  Math.max(Number(process.env.CATALOG_PAGE_SIZE) || 60, 1),
  100,
);

export function catalogQuery(
  rules: BrandRule[],
  filters: { vendors?: string[]; type?: string; types?: string[]; q?: string },
  status = "status",
) {
  const parts = [visibilityQuery(rules, status)];
  const vendors = (filters.vendors || []).filter(Boolean);
  if (vendors.length)
    parts.push(`(${vendors.map((v) => `vendor:${quoted(v)}`).join(" OR ")})`);
  const types = chosenTypes(filters);
  if (types.length)
    parts.push(`(${types.map((t) => `product_type:${quoted(t)}`).join(" OR ")})`);
  if (filters.q?.trim()) parts.push(`(${searchPrefix(filters.q)})`);
  return parts.join(" AND ");
}

export function isVisible(
  p: { vendor: string; status: string },
  rules: BrandRule[],
) {
  const rule = rules.find((r) => r.vendor === p.vendor);
  if (rule && !rule.visible) return false;
  return p.status === "ACTIVE" || p.status === "DRAFT";
}

/** Prix public HTVA en centimes, à partir du prix catalogue (TVAC si la boutique l'est). */
export function netPrice(amount: string, taxesIncluded: boolean) {
  return taxesIncluded ? Math.round(cents(amount) / 1.21) : cents(amount);
}

export async function brandRules(): Promise<BrandRule[]> {
  return db.brandSetting.findMany({ orderBy: { vendor: "asc" } });
}

const cardFields = `id title vendor productType status
  featuredMedia { preview { image { url altText } } }
  priceRangeV2 { minVariantPrice { amount } maxVariantPrice { amount } }
  variantsCount { count }`;

type RawCard = {
  id: string;
  title: string;
  vendor: string;
  productType: string;
  status: string;
  featuredMedia: {
    preview: { image: { url: string; altText: string | null } | null } | null;
  } | null;
  priceRangeV2: {
    minVariantPrice: { amount: string };
    maxVariantPrice: { amount: string };
  };
  variantsCount: { count: number } | null;
};

function card(p: RawCard, taxesIncluded: boolean): CatalogCard {
  return {
    id: p.id,
    numericId: p.id.split("/").pop() || "",
    title: p.title,
    vendor: p.vendor,
    productType: p.productType,
    status: p.status,
    image: p.featuredMedia?.preview?.image?.url || "",
    imageAlt: p.featuredMedia?.preview?.image?.altText || p.title,
    minPrice: netPrice(p.priceRangeV2.minVariantPrice.amount, taxesIncluded),
    maxPrice: netPrice(p.priceRangeV2.maxVariantPrice.amount, taxesIncluded),
    variants: p.variantsCount?.count ?? 1,
  };
}

const numeric = (gid: string) => gid.split("/").pop() || "";
export const finish = (title: string) =>
  title === "Default Title" ? "" : title;

type RawListed = RawCard & { variants: { nodes: { id: string; title: string }[] } };

/** Catalogue pro : une carte par produit, sa photo principale (le packshot),
 * et ses finitions à choisir au moment de l'ajout. Rien ne change dans Shopify. */
export async function listCatalog(
  admin: Admin | null,
  filters: {
    vendors?: string[];
    type?: string;
    types?: string[];
    q?: string;
    after?: string;
  },
) {
  const rules = await brandRules();
  if (!admin) return demoList(filters, rules);
  const info = await shopInfo(admin);
  const data = await gql<{
    products: {
      nodes: RawListed[];
      pageInfo: { hasNextPage: boolean; endCursor: string };
    };
  }>(
    admin,
    `query Catalog($query: String!, $after: String, $sort: ProductSortKeys!, $first: Int!) {
      products(first: $first, after: $after, query: $query, sortKey: $sort) {
        nodes { ${cardFields} variants(first: 1) { nodes { id title } } }
        pageInfo { hasNextPage endCursor }
      }
    }`,
    {
      query: catalogQuery(rules, filters),
      after: filters.after || null,
      first: CATALOG_PAGE,
      sort: filters.q?.trim() ? "RELEVANCE" : "TITLE",
    },
  );
  return {
    items: data.products.nodes
      .filter((p) => isVisible(p, rules) && p.variants.nodes.length)
      .map((p) => listedCard(card(p, info.taxesIncluded), p.variants.nodes[0])),
    next: data.products.pageInfo.hasNextPage
      ? data.products.pageInfo.endCursor
      : null,
  };
}

/** Carte du catalogue : l'identifiant est celui de la première variante, ajoutée
 * telle quelle quand le produit n'a qu'une finition. */
function listedCard(
  c: CatalogCard,
  first: { id: string; title: string },
): CatalogVariantCard {
  return {
    ...c,
    id: first.id,
    variantNumericId: numeric(first.id),
    variantTitle: c.variants > 1 ? "" : finish(first.title),
  };
}

export async function catalogFacets(admin: Admin | null) {
  const rules = await brandRules();
  if (!admin)
    return {
      vendors: [...new Set(demoProducts.map((p) => p.vendor))]
        .filter((v) => rules.find((r) => r.vendor === v)?.visible !== false)
        .sort(),
      types: [...new Set(demoProducts.map((p) => p.productType))].sort(),
    };
  const data = await gql<{
    productVendors: { nodes: string[] };
    productTypes: { nodes: string[] };
  }>(
    admin,
    `query Facets { productVendors(first: 250) { nodes } productTypes(first: 250) { nodes } }`,
  );
  const hidden = new Set(rules.filter((r) => !r.visible).map((r) => r.vendor));
  return {
    vendors: data.productVendors.nodes.filter((v) => v && !hidden.has(v)),
    types: data.productTypes.nodes.filter(Boolean),
  };
}

/** Familles des marques choisies, avec le nombre de fiches visibles (jusqu'à 1 000 fiches lues). */
export async function brandFamilies(
  admin: Admin | null,
  vendors: string[],
): Promise<{ type: string; count: number }[]> {
  if (!vendors.length) return [];
  const rules = await brandRules();
  const counts = new Map<string, number>();
  const add = (t: string) => t && counts.set(t, (counts.get(t) || 0) + 1);
  if (!admin) {
    demoProducts
      .filter((p) => vendors.includes(p.vendor) && isVisible(p, rules))
      .forEach((p) => add(p.productType));
  } else {
    let after: string | null = null;
    for (let page = 0; page < 4; page++) {
      const data: {
        products: {
          nodes: { productType: string; vendor: string; status: string }[];
          pageInfo: { hasNextPage: boolean; endCursor: string };
        };
      } = await gql(
        admin,
        `query Families($query: String!, $after: String) {
          products(first: 250, after: $after, query: $query) {
            nodes { productType vendor status }
            pageInfo { hasNextPage endCursor }
          }
        }`,
        { query: catalogQuery(rules, { vendors }), after },
      );
      data.products.nodes
        .filter((p) => isVisible(p, rules))
        .forEach((p) => add(p.productType));
      if (!data.products.pageInfo.hasNextPage) break;
      after = data.products.pageInfo.endCursor;
    }
  }
  return [...counts]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => a.type.localeCompare(b.type, "fr"));
}

export async function allVendors(admin: Admin | null) {
  if (!admin) return [...new Set(demoProducts.map((p) => p.vendor))].sort();
  const data = await gql<{ productVendors: { nodes: string[] } }>(
    admin,
    `query Vendors { productVendors(first: 250) { nodes } }`,
  );
  return data.productVendors.nodes.filter(Boolean);
}

/** Fiche d'un produit. `specs: false` pour un ajout au devis : les
 * caractéristiques coûtent cher en points Shopify et ne servent qu'à la fiche. */
export async function getCatalogProduct(
  admin: Admin | null,
  numericId: string,
  { specs: withSpecs = true }: { specs?: boolean } = {},
): Promise<CatalogProduct | null> {
  if (!/^\d{1,20}$/.test(numericId)) return null;
  const rules = await brandRules();
  if (!admin) {
    const p = demoProducts.find((x) => x.numericId === numericId);
    return p && isVisible(p, rules) ? p : null;
  }
  const [info, specs] = await Promise.all([
    shopInfo(admin),
    !withSpecs
      ? { product: null }
      : gql<{ product: { metafields: { nodes: RawMetafield[] } } | null }>(
      admin,
      `query CatalogSpecs($id: ID!) {
        product(id: $id) {
          metafields(first: 50) {
            nodes { namespace key type value definition { name }
              references(first: 4) { nodes { ... on Metaobject { displayName } } } }
          }
        }
      }`,
      { id: `gid://shopify/Product/${numericId}` },
    ).catch(() => ({ product: null })),
  ]);
  const data = await gql<{
    product:
      | (RawCard & {
          description: string;
          media: {
            nodes: { image?: { url: string; altText: string | null } | null }[];
          };
          options: { name: string; values: string[] }[];
          variants: {
            nodes: {
              id: string;
              title: string;
              sku: string | null;
              price: string;
              selectedOptions: { name: string; value: string }[];
              media: { nodes: { preview: { image: { url: string } | null } | null }[] };
            }[];
          };
        })
      | null;
  }>(
    admin,
    `query CatalogProduct($id: ID!) {
      product(id: $id) {
        ${cardFields}
        description
        media(first: 20) { nodes { ... on MediaImage { image { url altText } } } }
        options { name values }
        variants(first: 100) { nodes { id title sku price selectedOptions { name value } media(first: 1) { nodes { preview { image { url } } } } } }
      }
    }`,
    { id: `gid://shopify/Product/${numericId}` },
  );
  const p = data.product;
  if (!p || !isVisible(p, rules)) return null;
  return {
    ...card(p, info.taxesIncluded),
    description: p.description,
    specs: productSpecs(specs.product?.metafields.nodes || []),
    models3d: withSpecs
      ? productModels3d(specs.product?.metafields.nodes || [], p.vendor)
      : null,
    images: p.media.nodes
      .filter((m) => m.image?.url)
      .map((m) => ({ url: m.image!.url, alt: m.image!.altText || p.title })),
    options: p.options.filter((o) => o.name !== "Title"),
    productVariants: p.variants.nodes.map((v) => ({
      id: v.id,
      title: v.title,
      sku: v.sku || "",
      price: netPrice(v.price, info.taxesIncluded),
      options: v.selectedOptions,
      image: v.media.nodes[0]?.preview?.image?.url || "",
    })),
  };
}

// ——— Démonstration : catalogue fictif, sans appel à Shopify ———

const swatch = (color: string, label: string) =>
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800"><rect width="800" height="800" fill="${color}"/><text x="400" y="420" font-family="Inter,Arial" font-size="44" fill="#fff" text-anchor="middle">${label}</text></svg>`,
  );


function demo(
  n: number,
  title: string,
  vendor: string,
  productType: string,
  status: "ACTIVE" | "DRAFT",
  color: string,
  variants: [string, number][],
): CatalogProduct {
  const productVariants = variants.map(([t, price], i) => ({
    id: `gid://shopify/ProductVariant/9${n}0${i}`,
    title: t,
    sku: `DEMO-${n}-${i + 1}`,
    price,
    options: [{ name: "Finition", value: t }],
    image: "",
  }));
  const prices = productVariants.map((v) => v.price);
  return {
    id: `gid://shopify/Product/${n}`,
    numericId: String(n),
    title,
    vendor,
    productType,
    status,
    image: swatch(color, title),
    imageAlt: title,
    minPrice: Math.min(...prices),
    maxPrice: Math.max(...prices),
    variants: productVariants.length,
    description: `${title} de ${vendor}. Fiche fictive pour la démonstration : dimensions, matières et finitions viennent de Shopify en réel.`,
    specs: productSpecs(demoSpecs(n)),
    models3d: productModels3d(demoSpecs(n), vendor),
    images: [
      { url: swatch(color, title), alt: title },
      { url: swatch("#8a8577", "Détail"), alt: `${title}, détail` },
    ],
    options: [{ name: "Finition", values: variants.map(([t]) => t) }],
    productVariants,
  };
}

function demoSpecs(n: number): RawMetafield[] {
  const f = (key: string, name: string, value: string, type = "single_line_text_field"): RawMetafield => ({
    namespace: "custom",
    key,
    type,
    value,
    definition: { name },
  });
  return [
    f("width_cm", "Largeur (cm)", String(40 + (n % 5) * 10), "number_decimal"),
    f("depth_cm", "Profondeur (cm)", "52", "number_decimal"),
    f("height_cm", "Hauteur totale (cm)", "78.5", "number_decimal"),
    f("material", "Matériaux / Finitions", "Bois massif huilé ; assise tapissée"),
    f("designer", "Designer", "Studio fictif"),
    f("origin", "Fabrication / Origine", "Fabriqué au Danemark"),
    f("warranty", "Garantie", "2 ans"),
    f("product_fact_sheet_url", "Fiche technique", "https://example.com/fiche.pdf"),
    ...(n % 2
      ? [
          f(
            "models_3d",
            "Modèles 3D",
            JSON.stringify({
              files: [
                { format: "DWG", url: "https://example.com/modele.dwg" },
                { format: "SKP", url: "https://example.com/modele.skp" },
              ],
            }),
            "json",
          ),
        ]
      : []),
  ];
}

export const demoProducts: CatalogProduct[] = [
  demo(101, "Chaise Noma", "Maison Exemple", "Chaises", "ACTIVE", "#6b5b4b", [["Chêne naturel", 24000], ["Noyer", 27500]]),
  demo(102, "Table Épure", "Maison Exemple", "Tables", "ACTIVE", "#4b5b6b", [["Ø 80 cm", 89000], ["Ø 120 cm", 129000]]),
  demo(103, "Suspension Halo", "Lumière Douce", "Luminaires", "ACTIVE", "#b08a3e", [["Laiton", 42000]]),
  demo(104, "Lampadaire Arc", "Lumière Douce", "Luminaires", "ACTIVE", "#2f2f2f", [["Noir mat", 61000], ["Blanc", 61000]]),
  demo(105, "Fauteuil Dune", "Atelier Nord", "Fauteuils", "DRAFT", "#7d6e5a", [["Bouclé écru", 185000], ["Cuir cognac", 239000]]),
  demo(106, "Canapé Basse", "Atelier Nord", "Canapés", "DRAFT", "#5a6e7d", [["3 places", 420000]]),
  demo(107, "Vase Galet", "Objets Calmes", "Décoration", "ACTIVE", "#9aa39a", [["Grès", 6500]]),
  demo(108, "Étagère Ligne", "Maison Exemple", "Rangement", "ACTIVE", "#3e4a3e", [["Frêne", 74000]]),
];

function demoList(
  filters: { vendors?: string[]; type?: string; types?: string[]; q?: string; after?: string },
  rules: BrandRule[],
) {
  const q = (filters.q || "").toLowerCase().trim();
  const types = chosenTypes(filters);
  const all = demoProducts
      .filter((p) => isVisible(p, rules))
      .filter((p) => !filters.vendors?.length || filters.vendors.includes(p.vendor))
      .filter((p) => !types.length || types.includes(p.productType))
      .map(({ description: _d, images: _i, options: _o, specs: _s, models3d: _m, productVariants, ...c }) =>
        listedCard(c, productVariants[0]),
      )
      .filter((p) => !q || `${p.title} ${p.vendor} ${p.productType}`.toLowerCase().includes(q));
  const start = Number(filters.after) || 0,
    end = start + CATALOG_PAGE;
  return {
    items: all.slice(start, end),
    next: end < all.length ? String(end) : (null as string | null),
  };
}
