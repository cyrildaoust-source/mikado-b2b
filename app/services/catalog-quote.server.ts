import db from "../db.server";
import {
  newQuote,
  lineSchema,
  quoteSchema,
  quoteSections,
  repriceExtras,
  upgradeQuote,
  type Line,
  type QuoteState,
} from "../domain/quote";
import type { CatalogProduct } from "./catalog.server";
import { productsByIds, shopInfo, type Admin } from "./shopify-api.server";
import { createQuote, getQuote, saveQuote } from "./quotes.server";

/** Où placer une variante du catalogue dans un devis. */
export type Placement =
  | { kind: "end" }
  | { kind: "section"; id: string }
  | { kind: "newSection"; title: string }
  | { kind: "alternative"; group: string }
  | { kind: "option" };

export function parsePlacement(raw: string): Placement {
  const [kind, ...rest] = raw.split(":"),
    value = rest.join(":").slice(0, 150);
  if (kind === "section" && value) return { kind, id: value };
  if (kind === "newSection" && value.trim()) return { kind, title: value.trim() };
  if (kind === "alternative" && value) return { kind, group: value };
  if (kind === "option") return { kind };
  return { kind: "end" };
}

/** Ajoute une variante du catalogue à un devis : dans une pièce, en alternative ou en option. */
export function addLineToState(
  state: QuoteState,
  line: Line,
  qty: number,
  placement: Placement = { kind: "end" },
) {
  const s = state.schemaVersion === 1 ? upgradeQuote(state) : state;
  const item = { ...line, id: crypto.randomUUID(), qty };
  if (placement.kind === "option")
    return repriceExtras(
      quoteSchema.parse({
        ...s,
        extras: [...s.extras, { ...item, selected: false }],
      }),
    );
  if (placement.kind === "alternative") {
    const group = s.groups.find((g) => g.id === placement.group);
    if (!group) throw Error("Ce produit n'est plus dans le devis. Rechargez la page.");
    return repriceExtras(
      quoteSchema.parse({
        ...s,
        groups: s.groups.map((g) =>
          g.id === group.id
            ? {
                ...g,
                items: [
                  ...g.items,
                  { ...item, qty: g.syncQty ? g.items[0].qty : qty },
                ],
              }
            : g,
        ),
      }),
    );
  }
  const sections = quoteSections(s),
    chosen =
      placement.kind === "section"
        ? sections.find((x) => x.id === placement.id)
        : placement.kind === "end"
          ? sections.at(-1)
          : undefined;
  if (placement.kind === "section" && !chosen)
    throw Error("Cette pièce n'est plus dans le devis. Rechargez la page.");
  const title =
    placement.kind === "newSection" ? placement.title : chosen?.title || "Produits";
  const sectionId =
    chosen && !chosen.id.startsWith("legacy:") ? chosen.id : chosen ? "" : crypto.randomUUID();
  // repriceExtras : la livraison au pourcentage suit les produits ajoutés.
  return repriceExtras(
    quoteSchema.parse({
      ...s,
      groups: [
        ...s.groups,
        {
          id: crypto.randomUUID(),
          sectionId,
          section: title,
          selected: item.id,
          syncQty: true,
          items: [item],
        },
      ],
    }),
  );
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
  placement?: Placement;
}) {
  if (!Number.isInteger(opts.qty) || opts.qty < 1 || opts.qty > 10000)
    throw Error("Quantité invalide.");
  const line = await lineFor(opts.admin, opts.product, opts.variantId);
  if (opts.quoteId === "new") {
    const shop = await shopInfo(opts.admin);
    const state = addLineToState(
      { ...newQuote(shop.taxesIncluded), project: opts.product.title },
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
    opts.placement,
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
