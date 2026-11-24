import db from "../db.server";
import {
  emptyQuote,
  lineSchema,
  quoteSchema,
  quoteSections,
  upgradeQuote,
  type Line,
  type QuoteState,
} from "../domain/quote";
import type { CatalogProduct } from "./catalog.server";
import { productsByIds, shopInfo, type Admin } from "./shopify-api.server";
import { createQuote, getQuote, saveQuote } from "./quotes.server";

/** Ajoute une variante du catalogue à un devis, comme une nouvelle ligne retenue. */
export function addLineToState(state: QuoteState, line: Line, qty: number) {
  const s = state.schemaVersion === 1 ? upgradeQuote(state) : state;
  const last = quoteSections(s).at(-1);
  const item = { ...line, id: crypto.randomUUID(), qty };
  return quoteSchema.parse({
    ...s,
    groups: [
      ...s.groups,
      {
        id: crypto.randomUUID(),
        sectionId: last?.id.startsWith("legacy:") ? "" : last?.id || crypto.randomUUID(),
        section: last?.title || "Produits",
        selected: item.id,
        syncQty: true,
        items: [item],
      },
    ],
  });
}

async function lineFor(
  admin: Admin | null,
  product: CatalogProduct,
  variantId: string,
): Promise<Line> {
  const variant = product.productVariants.find((v) => v.id === variantId);
  if (!variant) throw Error("Cette finition n'appartient pas au produit.");
  if (!admin)
    return lineSchema.parse({
      id: variant.id,
      name: `${product.title} - ${variant.title}`,
      sku: variant.sku,
      detail: "",
      qty: 1,
      price: variant.price,
      discount: 0,
      variantId: null,
      image: product.image,
      vatRate: 21,
    });
  const [line] = (await productsByIds(admin, [variantId])).items;
  if (!line.taxable)
    throw Error(
      "Cet article est configuré sans taxe dans Shopify. Demandez à Mikado Deco de le corriger.",
    );
  return line;
}

export async function addToQuote(opts: {
  shop: string;
  admin: Admin | null;
  owner: number | null;
  ownerId: number | null;
  product: CatalogProduct;
  variantId: string;
  qty: number;
  quoteId: number | "new";
}) {
  if (!Number.isInteger(opts.qty) || opts.qty < 1 || opts.qty > 10000)
    throw Error("Quantité invalide.");
  const line = await lineFor(opts.admin, opts.product, opts.variantId);
  if (opts.quoteId === "new") {
    const shop = await shopInfo(opts.admin);
    const state = addLineToState(
      { ...emptyQuote(shop.taxesIncluded), project: opts.product.title },
      line,
      opts.qty,
    );
    return (await createQuote(opts.shop, state, opts.ownerId)).id;
  }
  const where =
    opts.owner === null
      ? { id: opts.quoteId, shop: opts.shop }
      : { id: opts.quoteId, shop: opts.shop, ownerId: opts.owner };
  if (!(await db.quote.findFirst({ where, select: { id: true } })))
    throw Error("Devis introuvable.");
  const q = await getQuote(opts.shop, opts.quoteId);
  const state = addLineToState(
    quoteSchema.parse(JSON.parse(q.state)),
    line,
    opts.qty,
  );
  await saveQuote(opts.shop, q.id, q.version, state);
  return q.id;
}

/** Devis modifiables proposés dans le bouton « Ajouter au devis ». */
export async function openQuotes(shop: string, owner: number | null) {
  return db.quote.findMany({
    where: {
      shop,
      status: "draft",
      ...(owner === null ? {} : { ownerId: owner }),
      OR: [
        { conversion: null },
        { conversion: { status: { in: ["preview", "rejected"] } } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 30,
    select: { id: true, title: true, customer: true, number: true },
  });
}
