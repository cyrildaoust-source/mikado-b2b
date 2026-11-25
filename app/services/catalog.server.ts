import db from "../db.server";
import { cents } from "../domain/quote";
import { gql, searchPrefix, shopInfo, type Admin } from "./shopify-api.server";

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
  images: { url: string; alt: string }[];
  options: { name: string; values: string[] }[];
  productVariants: CatalogVariant[];
};

const quoted = (v: string) => '"' + v.replace(/[\\"]/g, "\\$&") + '"';

/** Requête de recherche Shopify qui limite le catalogue à ce que Mikado Deco ouvre aux pros. */
export function visibilityQuery(rules: BrandRule[]) {
  const hidden = rules.filter((r) => !r.visible).map((r) => r.vendor);
  return `((${["(status:active OR status:draft)", ...hidden.map((v) => `-vendor:${quoted(v)}`)].join(" AND ")}))`;
}

export function catalogQuery(
  rules: BrandRule[],
  filters: { vendor?: string; type?: string; q?: string },
) {
  const parts = [visibilityQuery(rules)];
  if (filters.vendor) parts.push(`vendor:${quoted(filters.vendor)}`);
  if (filters.type) parts.push(`product_type:${quoted(filters.type)}`);
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

export async function listCatalog(
  admin: Admin | null,
  filters: { vendor?: string; type?: string; q?: string; after?: string },
) {
  const rules = await brandRules();
  if (!admin) return demoList(filters, rules);
  const info = await shopInfo(admin);
  const data = await gql<{
    products: {
      nodes: RawCard[];
      pageInfo: { hasNextPage: boolean; endCursor: string };
    };
  }>(
    admin,
    `query Catalog($query: String!, $after: String, $sort: ProductSortKeys!, $reverse: Boolean!) {
      products(first: 24, after: $after, query: $query, sortKey: $sort, reverse: $reverse) {
        nodes { ${cardFields} }
        pageInfo { hasNextPage endCursor }
      }
    }`,
    {
      query: catalogQuery(rules, filters),
      after: filters.after || null,
      sort: filters.q?.trim() ? "RELEVANCE" : "TITLE",
      reverse: false,
    },
  );
  return {
    items: data.products.nodes
      .filter((p) => isVisible(p, rules))
      .map((p) => card(p, info.taxesIncluded)),
    next: data.products.pageInfo.hasNextPage
      ? data.products.pageInfo.endCursor
      : null,
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

export async function allVendors(admin: Admin | null) {
  if (!admin) return [...new Set(demoProducts.map((p) => p.vendor))].sort();
  const data = await gql<{ productVendors: { nodes: string[] } }>(
    admin,
    `query Vendors { productVendors(first: 250) { nodes } }`,
  );
  return data.productVendors.nodes.filter(Boolean);
}

export async function getCatalogProduct(
  admin: Admin | null,
  numericId: string,
): Promise<CatalogProduct | null> {
  if (!/^\d{1,20}$/.test(numericId)) return null;
  const rules = await brandRules();
  if (!admin) {
    const p = demoProducts.find((x) => x.numericId === numericId);
    return p && isVisible(p, rules) ? p : null;
  }
  const info = await shopInfo(admin);
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
              image: { url: string } | null;
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
        variants(first: 100) { nodes { id title sku price selectedOptions { name value } image { url } } }
      }
    }`,
    { id: `gid://shopify/Product/${numericId}` },
  );
  const p = data.product;
  if (!p || !isVisible(p, rules)) return null;
  return {
    ...card(p, info.taxesIncluded),
    description: p.description,
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
      image: v.image?.url || "",
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
    images: [
      { url: swatch(color, title), alt: title },
      { url: swatch("#8a8577", "Détail"), alt: `${title}, détail` },
    ],
    options: [{ name: "Finition", values: variants.map(([t]) => t) }],
    productVariants,
  };
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
  filters: { vendor?: string; type?: string; q?: string },
  rules: BrandRule[],
) {
  const q = (filters.q || "").toLowerCase().trim();
  return {
    items: demoProducts
      .filter((p) => isVisible(p, rules))
      .filter((p) => !filters.vendor || p.vendor === filters.vendor)
      .filter((p) => !filters.type || p.productType === filters.type)
      .filter((p) => !q || `${p.title} ${p.vendor} ${p.productType}`.toLowerCase().includes(q))
      .map(({ description: _d, images: _i, options: _o, productVariants: _v, ...c }) => c),
    next: null as string | null,
  };
}
