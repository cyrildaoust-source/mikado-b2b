import { grossUnit, type QuoteState } from "./quote";

/**
 * Ce que la page du client reçoit d'une révision figée : une liste blanche de
 * champs. Restent chez Mikado Pro : identifiants Shopify (produit, variante,
 * client), prix source du catalogue, famille, référence interne, adresses,
 * e-mail et TVA du client. Le prix pro et la remise de palier ne sont jamais
 * dans un devis ; ils ne peuvent donc pas fuiter par ici.
 */
type Line = QuoteState["groups"][number]["items"][number];
type Extra = QuoteState["extras"][number];

const lineFields = (l: Line) => ({
  id: l.id,
  name: l.name,
  detail: l.detail,
  image: l.image,
  qty: l.qty,
  price: l.price,
  discount: l.discount,
  taxable: l.taxable,
  vatRate: l.vatRate,
  priceConfirmed: l.priceConfirmed,
  chargePercent: l.chargePercent,
  // Prix public TVAC de la boutique (celui du site), quand la ligne en part :
  // le total du client tombe alors au centime sur le prix du site.
  gross: grossUnit(l),
  ...(l.deliveryFee ? { deliveryFee: true } : {}),
});

export type ClientLine = ReturnType<typeof lineFields>;

export function clientQuote(s: QuoteState) {
  return {
    schemaVersion: s.schemaVersion,
    taxPolicy: s.taxPolicy,
    payment: s.payment,
    depositPercent: s.depositPercent,
    project: s.project,
    client: s.client,
    firstName: s.firstName,
    lastName: s.lastName,
    validity: s.validity,
    terms: s.terms,
    delivery: s.delivery,
    note: s.note,
    hideDiscounts: s.hideDiscounts,
    taxesIncluded: s.taxesIncluded,
    groups: s.groups.map((g) => ({
      id: g.id,
      section: g.section,
      sectionId: g.sectionId,
      selected: g.selected,
      items: g.items.map(lineFields),
    })),
    extras: s.extras.map((e: Extra) => ({
      ...lineFields(e),
      selected: e.selected,
      ...(e.parent ? { parent: e.parent } : {}),
    })),
  };
}

export type ClientQuote = ReturnType<typeof clientQuote>;

/** Champs internes neutres : les calculs du devis tournent sans eux. */
const blankLine = ({ gross, ...l }: ClientLine): Line => ({
  ...l,
  sku: "",
  variantId: null,
  requiresShipping: true,
  sourcePrice: gross ?? null,
  sourceIncludesTax: gross != null,
  sourceVatRate: gross != null ? l.vatRate : null,
  ...(gross != null ? { exactGross: true } : {}),
});
const blankAddress = {
  address1: "",
  address2: "",
  city: "",
  zip: "",
  countryCode: "BE",
  company: "",
  firstName: "",
  lastName: "",
};

/** Révision complète pour les calculs côté navigateur, sans donnée interne. */
export function fromClientQuote(c: ClientQuote): QuoteState {
  return {
    ...c,
    contact: "",
    email: "",
    customerId: null,
    customerVat: "",
    company: "",
    shipping: blankAddress,
    billing: blankAddress,
    billingSame: true,
    currency: "EUR",
    groups: c.groups.map((g) => ({
      ...g,
      syncQty: false,
      items: g.items.map(blankLine),
    })),
    extras: c.extras.map((e) => ({ ...blankLine(e), selected: e.selected, parent: e.parent })),
  };
}
