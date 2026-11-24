import { operations } from "./operations";
import {
  addressSchema,
  lineSchema,
  amount,
  cents,
  selectedLines,
  totals,
  fiscalTotals,
  assertPriced,
  type QuoteState,
  type Line,
} from "../domain/quote";
export type Admin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};
export class ShopifyRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopifyRejected";
  }
}
export function definiteRejection(error: unknown) {
  if (error instanceof ShopifyRejected) return true;
  if (error instanceof Response)
    return [400, 401, 403, 429].includes(error.status);
  const e = error as {
    response?: { code?: number; status?: number };
    body?: {
      data?: unknown;
      errors?: {
        graphQLErrors?: { extensions?: { code?: string }; path?: unknown }[];
      };
    };
  };
  if (
    [400, 401, 403, 429].includes(e?.response?.code || e?.response?.status || 0)
  )
    return true;
  const errors = e?.body?.errors?.graphQLErrors;
  return (
    !e?.body?.data &&
    Array.isArray(errors) &&
    errors.length > 0 &&
    errors.every(
      (x) =>
        !x.path &&
        ["THROTTLED", "ACCESS_DENIED", "GRAPHQL_VALIDATION_FAILED"].includes(
          x.extensions?.code || "",
        ),
    )
  );
}
export async function gql<T>(
  admin: Admin,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const response = await admin.graphql(query, { variables });
  const body = await response.json();
  if (!response.ok) {
    if ([400, 401, 403, 429].includes(response.status))
      throw new ShopifyRejected(
        "Shopify a refusé la requête. Vérifiez les accès ou réessayez après quelques instants.",
      );
    throw Error("Shopify indisponible");
  }
  if (body.errors?.length) {
    if (
      !body.data &&
      body.errors.every(
        (e: { path?: unknown; extensions?: { code?: string } }) =>
          !e.path &&
          ["THROTTLED", "ACCESS_DENIED", "GRAPHQL_VALIDATION_FAILED"].includes(
            e.extensions?.code || "",
          ),
      )
    )
      throw new ShopifyRejected("Requête refusée par Shopify avant exécution.");
    throw Error("Réponse Shopify incomplète.");
  }
  if (!body.data) throw Error("Réponse Shopify incomplète");
  return body.data as T;
}
export async function shopInfo(admin: Admin | null) {
  if (!admin)
    return {
      name: "Mikado Deco — démonstration",
      currencyCode: "EUR",
      taxesIncluded: false,
    };
  return (
    await gql<{
      shop: { name: string; currencyCode: string; taxesIncluded: boolean };
    }>(admin, operations.shop)
  ).shop;
}
export const demoLines: Line[] = [
  {
    id: "demo-chair",
    name: "Chaise Noma",
    sku: "NOMA-01",
    detail: "Chêne naturel",
    qty: 1,
    price: 10000,
    discount: 0,
    variantId: null,
    image: "",
    taxable: true,
    requiresShipping: true,
  },
  {
    id: "demo-alba",
    name: "Chaise Alba",
    sku: "ALBA-02",
    detail: "Assise tapissée",
    qty: 1,
    price: 12000,
    discount: 0,
    variantId: null,
    image: "",
    taxable: true,
    requiresShipping: true,
  },
  {
    id: "demo-table",
    name: "Table Épure",
    sku: "EPU-80",
    detail: "Ø 80 cm",
    qty: 1,
    price: 32000,
    discount: 0,
    variantId: null,
    image: "",
    taxable: true,
    requiresShipping: true,
  },
].map((l) => lineSchema.parse({ ...l, detail: "", vatRate: 21 }));
const literal = (s: string) => '"' + s.replace(/[\\"]/g, "\\$&") + '"';
export function searchPrefix(s: string) {
  return s
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/[\\:\(\)"'*<>!=]/g, "\\$&") + "*")
    .join(" ");
}
export function customerSearch(s: string) {
  const query = searchPrefix(s);
  return s.includes("@") ? `email:${query}` : query;
}
export async function products(
  admin: Admin | null,
  search: string,
  after?: string,
) {
  if (!admin)
    return {
      items: demoLines.filter((i) =>
        (i.name + " " + i.sku).toLowerCase().includes(search.toLowerCase()),
      ),
      next: null,
    };
  const info = await shopInfo(admin);
  const result = await gql<{
    productVariants: {
      nodes: {
        id: string;
        displayName: string;
        product: {
          description: string;
          featuredMedia?: {
            preview: { image: { url: string } | null } | null;
          } | null;
        };
        sku: string | null;
        taxable: boolean;
        price: string;
        image: { url: string } | null;
      }[];
      pageInfo: { hasNextPage: boolean; endCursor: string };
    };
  }>(admin, operations.products, {
    query: search ? searchPrefix(search) : undefined,
    after,
  });
  return {
    items: result.productVariants.nodes.map((v) =>
      catalogLine(v, info.taxesIncluded),
    ),
    next: result.productVariants.pageInfo.hasNextPage
      ? result.productVariants.pageInfo.endCursor
      : null,
  };
}
export async function customers(
  admin: Admin | null,
  search: string,
  after?: string,
) {
  if (!admin)
    return {
      items: [
        {
          id: null,
          name: "Maison Auguste",
          email: "",
          address: addressSchema.parse({
            address1: "Rue des Jardins 12",
            city: "Bruxelles",
            zip: "1000",
            company: "Maison Auguste",
          }),
        },
      ].filter((i) =>
        `${i.name} ${i.email}`.toLowerCase().includes(search.toLowerCase()),
      ),
      next: null,
    };
  const q = search ? customerSearch(search) : undefined;
  const r = await gql<{
    customers: {
      nodes: {
        id: string;
        displayName: string;
        defaultEmailAddress: { emailAddress: string } | null;
        defaultAddress: Record<string, string | null> | null;
      }[];
      pageInfo: { hasNextPage: boolean; endCursor: string };
    };
  }>(admin, operations.customers, { query: q, after });
  return {
    items: r.customers.nodes.map((c) => ({
      id: c.id,
      name: c.displayName,
      email: c.defaultEmailAddress?.emailAddress || "",
      address: addressSchema.parse({
        ...Object.fromEntries(
          Object.entries(c.defaultAddress || {}).filter(([, v]) => v !== null),
        ),
        countryCode: c.defaultAddress?.countryCodeV2 || "BE",
      }),
    })),
    next: r.customers.pageInfo.hasNextPage
      ? r.customers.pageInfo.endCursor
      : null,
  };
}
export function draftInput(
  s: QuoteState,
  ref: string,
  tag: string,
  shopTaxesIncluded = false,
  roundingAdjustment = 0,
) {
  assertPriced(s);
  const lines = selectedLines(s);
  if (!lines.length) throw Error("Ajoutez au moins une ligne retenue.");
  if (!s.shipping.address1 || !s.shipping.city || !s.shipping.zip)
    throw Error("Complétez l’adresse de livraison pour calculer les taxes.");
  const adjustmentLine = roundingAdjustment
    ? lines.find((line) => line.deliveryFee && line.taxable && line.qty === 1) ||
      lines.find((line) => line.taxable && line.qty === 1)
    : null;
  if (roundingAdjustment && !adjustmentLine)
    throw Error("Aucune ligne ne permet de corriger l’arrondi Shopify.");
  return {
    presentmentCurrencyCode: s.currency,
    purchasingEntity: s.customerId ? { customerId: s.customerId } : undefined,
    email: s.email || undefined,
    shippingAddress: s.shipping,
    billingAddress: s.billingSame ? s.shipping : s.billing,
    note: `${ref}\n${s.project}\nPaiement : ${s.terms}\nLivraison : ${s.delivery}\nTVA client : ${s.customerVat}\n${s.note}`,
    tags: ["mikado-devis", tag],
    acceptAutomaticDiscounts: false,
    allowDiscountCodesInCheckout: false,
    visibleToCustomer: false,
    lineItems: lines.map((l) => {
      const basePrice =
        shopTaxesIncluded && l.taxable
          ? Math.round(l.price * (1 + l.vatRate! / 100))
          : l.price;
      const price =
        l.id === adjustmentLine?.id
          ? basePrice + roundingAdjustment
          : basePrice;
      if (price < 0) throw Error("L’ajustement d’arrondi rend un prix invalide.");
      return {
        quantity: l.qty,
        uuid: l.id,
        ...(l.variantId
          ? {
              variantId: l.variantId,
              priceOverride: {
                amount: amount(price),
                currencyCode: s.currency,
              },
            }
          : {
              title: l.name,
              sku: l.sku,
              originalUnitPriceWithCurrency: {
                amount: amount(price),
                currencyCode: s.currency,
              },
              taxable: l.taxable,
              requiresShipping: l.requiresShipping,
            }),
        ...(l.discount
          ? {
              appliedDiscount: {
                value: l.discount,
                valueType: "PERCENTAGE",
                title: "Remise devis",
              },
            }
          : {}),
      };
    }),
  };
}
export type Calculation = {
  total: number;
  tax: number;
  subtotal: number;
  taxesIncluded: boolean;
  currency: string;
  localTotal: number;
  demo: boolean;
  taxLines: { rate: number; amount: number }[];
  difference: number;
  matches: boolean;
  roundingAdjustment?: number;
  checkedAt?: string;
};
export async function calculate(
  admin: Admin | null,
  s: QuoteState,
  input: ReturnType<typeof draftInput>,
): Promise<Calculation> {
  const f = fiscalTotals(s);
  if (!admin)
    return {
      total: f.gross,
      tax: f.tax,
      subtotal: f.net,
      taxesIncluded: false,
      currency: "EUR",
      localTotal: f.net,
      demo: true,
      taxLines: f.taxLines,
      difference: 0,
      matches: true,
    };
  type Bag = { presentmentMoney: { amount: string; currencyCode: string } };
  const { draftOrderCalculate: r } = await gql<{
    draftOrderCalculate: {
      calculatedDraftOrder: {
        totalPriceSet: Bag;
        totalTaxSet: Bag;
        subtotalPriceSet: Bag;
        taxesIncluded: boolean;
        taxLines: { rate: number | null; priceSet: Bag }[];
        lineItems: {
          uuid: string;
          quantity: number;
          discountedTotalSet: Bag;
        }[];
      } | null;
      userErrors: { message: string }[];
    };
  }>(admin, operations.calculate, { input });
  if (r.userErrors.length)
    throw new ShopifyRejected(r.userErrors.map((e) => e.message).join("; "));
  if (!r.calculatedDraftOrder) throw Error("Calcul Shopify incomplet");
  const d = r.calculatedDraftOrder,
    total = cents(d.totalPriceSet.presentmentMoney.amount),
    tax = cents(d.totalTaxSet.presentmentMoney.amount),
    net = total - tax;
  const bins = new Map<number, number>();
  let known = true;
  for (const line of d.taxLines) {
    if (line.rate === null) {
      known = false;
      continue;
    }
    const rate = Math.round(line.rate * 10000) / 100;
    bins.set(
      rate,
      (bins.get(rate) || 0) + cents(line.priceSet.presentmentMoney.amount),
    );
  }
  const taxLines = [...bins]
    .sort(([a], [b]) => a - b)
    .map(([rate, amount]) => ({ rate, amount }));
  const totalQuantity = input.lineItems.reduce((sum, item) => sum + item.quantity, 0),
    roundingTolerance = Math.max(1, totalQuantity),
    lineMatch =
      d.lineItems.length === input.lineItems.length &&
      d.lineItems.every((l) => {
        const i = input.lineItems.find((x) => x.uuid === l.uuid);
        if (!i || i.quantity !== l.quantity) return false;
        const price = cents(
          "priceOverride" in i
            ? i.priceOverride.amount
            : i.originalUnitPriceWithCurrency.amount,
        );
        const expected = Math.round(
          (price * i.quantity * (100 - (i.appliedDiscount?.value || 0))) /
            100,
        );
        return (
          Math.abs(
            cents(l.discountedTotalSet.presentmentMoney.amount) - expected,
          ) <= i.quantity
        );
      });
  const taxLinesMatch =
    taxLines.length === f.taxLines.length &&
    taxLines.every((line) => {
      const local = f.taxLines.find((item) => item.rate === line.rate);
      return local && Math.abs(line.amount - local.amount) <= roundingTolerance;
    });
  return {
    total,
    tax,
    subtotal: net,
    taxesIncluded: d.taxesIncluded,
    currency: d.totalPriceSet.presentmentMoney.currencyCode,
    localTotal: f.net,
    demo: false,
    taxLines,
    difference: net - f.net,
    matches:
      known &&
      lineMatch &&
      d.totalPriceSet.presentmentMoney.currencyCode === "EUR" &&
      taxLinesMatch &&
      Math.abs(net - f.net) <= roundingTolerance &&
      Math.abs(tax - f.tax) <= roundingTolerance &&
      Math.abs(total - f.gross) <= roundingTolerance,
  };
}
export async function prepareCalculation(
  admin: Admin | null,
  s: QuoteState,
  ref: string,
  tag: string,
) {
  const shop = await shopInfo(admin);
  if (shop.currencyCode !== s.currency)
    throw Error("La devise Shopify a changé.");
  const input = draftInput(s, ref, tag, shop.taxesIncluded),
    calculation = await calculate(admin, s, input),
    fiscal = fiscalTotals(s),
    adjustment = fiscal.gross - calculation.total;
  if (
    shop.taxesIncluded &&
    adjustment !== 0 &&
    Math.abs(adjustment) <= 100
  ) {
    try {
      const adjustedInput = draftInput(
          s,
          ref,
          tag,
          shop.taxesIncluded,
          adjustment,
        ),
        adjusted = await calculate(admin, s, adjustedInput),
        exact =
          adjusted.total === fiscal.gross &&
          adjusted.tax === fiscal.tax &&
          adjusted.subtotal === fiscal.net;
      if (exact)
        return {
          input: adjustedInput,
          calculation: {
            ...adjusted,
            matches: adjusted.matches && exact,
            roundingAdjustment: adjustment,
          },
        };
    } catch {
      // The unadjusted calculation below remains visible for diagnosis.
    }
  }
  const exact =
    calculation.total === fiscal.gross &&
    calculation.tax === fiscal.tax &&
    calculation.subtotal === fiscal.net;
  return {
    input,
    calculation: {
      ...calculation,
      matches: calculation.matches && exact,
      roundingAdjustment: 0,
    },
  };
}
export async function createDraft(
  admin: Admin,
  input: ReturnType<typeof draftInput>,
) {
  const { draftOrderCreate: r } = await gql<{
    draftOrderCreate: {
      draftOrder: {
        id: string;
        name: string;
        totalPriceSet: {
          presentmentMoney: { amount: string; currencyCode: string };
        };
      } | null;
      userErrors: { message: string }[];
    };
  }>(admin, operations.create, { input });
  if (r.userErrors.length)
    throw new ShopifyRejected(r.userErrors.map((e) => e.message).join("; "));
  if (!r.draftOrder)
    throw Error("Création sans résultat : vérification nécessaire.");
  return r.draftOrder;
}
export async function recoverDraft(admin: Admin, tag: string) {
  const r = await gql<{
    draftOrders: { nodes: { id: string; name: string }[] };
  }>(admin, operations.recover, { query: `tag:${literal(tag)}` });
  return r.draftOrders.nodes;
}

type CatalogVariant = {
  id: string;
  displayName: string;
  sku: string | null;
  taxable: boolean;
  price: string;
  product: {
    description: string;
    featuredMedia?: {
      preview: { image: { url: string } | null } | null;
    } | null;
  };
  image: { url: string } | null;
};
function catalogLine(v: CatalogVariant, taxesIncluded: boolean) {
  return lineSchema.parse({
    id: v.id,
    name: v.displayName,
    sku: v.sku || "",
    detail: v.product.description,
    vatRate: 21,
    qty: 1,
    price:
      taxesIncluded && v.taxable
        ? Math.round(cents(v.price) / 1.21)
        : cents(v.price),
    sourcePrice: cents(v.price),
    sourceIncludesTax: taxesIncluded,
    priceConfirmed: true,
    sourceVatRate: taxesIncluded && v.taxable ? 21 : null,
    discount: 0,
    variantId: v.id,
    image: v.image?.url || v.product.featuredMedia?.preview?.image?.url || "",
    taxable: v.taxable,
    requiresShipping: true,
  });
}
export async function productsByIds(admin: Admin | null, ids: string[]) {
  if (!admin) throw Error("Sélecteur Shopify indisponible en démonstration.");
  if (
    !ids.length ||
    ids.length > 100 ||
    ids.some((id) => !/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(id))
  )
    throw Error("Sélection invalide.");
  const info = await shopInfo(admin);
  const data = await gql<{ nodes: (CatalogVariant | null)[] }>(
    admin,
    operations.variants,
    { ids },
  );
  if (data.nodes.some((n) => !n))
    throw Error("Un produit sélectionné n’est plus disponible.");
  return {
    items: data.nodes.map((v) => catalogLine(v!, info.taxesIncluded)),
    next: null,
  };
}

export async function verifyCreatedDraft(
  admin: Admin,
  id: string,
  state: QuoteState,
  calculation: Calculation,
) {
  type Bag = { presentmentMoney: { amount: string; currencyCode: string } };
  type Item = {
    uuid: string;
    quantity: number;
    variant: { id: string } | null;
    discountedTotalSet: Bag;
  };
  type Snapshot = {
    id: string;
    name: string;
    totalPriceSet: Bag;
    totalTaxSet: Bag;
    lineItems: {
      nodes: Item[];
      pageInfo: { hasNextPage: boolean; endCursor: string };
    };
  };
  const lines: Item[] = [];
  let after: string | undefined,
    snapshot: Snapshot | null = null;
  for (let page = 0; page < 5; page++) {
    const data = await gql<{ draftOrder: Snapshot | null }>(
      admin,
      operations.inspectDraft,
      { id, after },
    );
    if (!data.draftOrder) throw Error("Commande introuvable après création.");
    snapshot = data.draftOrder;
    lines.push(...snapshot.lineItems.nodes);
    if (!snapshot.lineItems.pageInfo.hasNextPage) break;
    after = snapshot.lineItems.pageInfo.endCursor;
    if (page === 4)
      throw Error(
        "Commande trop volumineuse pour une vérification automatique.",
      );
  }
  const expected = draftInput(
    state,
    "Vérification",
    "verification",
    calculation.taxesIncluded,
    calculation.roundingAdjustment || 0,
  ).lineItems;
  const match =
    snapshot &&
    snapshot.totalPriceSet.presentmentMoney.currencyCode === "EUR" &&
    cents(snapshot.totalPriceSet.presentmentMoney.amount) ===
      calculation.total &&
    cents(snapshot.totalTaxSet.presentmentMoney.amount) === calculation.tax &&
    lines.length === expected.length &&
    new Set(lines.map((l) => l.uuid)).size === lines.length &&
    lines.every((l) => {
      const i = expected.find((i) => i.uuid === l.uuid);
      if (
        !i ||
        i.quantity !== l.quantity ||
        ("variantId" in i ? i.variantId : null) !== (l.variant?.id || null)
      )
        return false;
      const price = cents(
        "priceOverride" in i
          ? i.priceOverride.amount
          : i.originalUnitPriceWithCurrency.amount,
      );
      const expectedTotal = Math.round(
        (price * i.quantity * (100 - (i.appliedDiscount?.value || 0))) /
          100,
      );
      return (
        l.discountedTotalSet.presentmentMoney.currencyCode === "EUR" &&
        Math.abs(
          cents(l.discountedTotalSet.presentmentMoney.amount) - expectedTotal,
        ) <= i.quantity
      );
    });
  if (!match)
    throw Error(
      "La commande Shopify existe mais ses montants ou lignes diffèrent. Vérifiez-la avant de poursuivre ; aucune nouvelle commande ne sera créée.",
    );
  return { id: snapshot!.id, name: snapshot!.name };
}
