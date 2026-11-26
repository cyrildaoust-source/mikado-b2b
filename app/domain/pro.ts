/**
 * Prix pro de l'architecte : le prix public moins la remise de sa classe
 * (palier). C'est la seule réduction du portail pro, sans promotion ni autre
 * remise (Cyril, 26/11/2026). Un pourcentage donne le même résultat HTVA ou
 * TVAC. L'affichage est un choix de l'architecte : il ne change ni le devis
 * ni le PDF.
 */
export type ProPricing = {
  /** Remise de la classe en pour cent ; null quand l'architecte n'a pas de classe. */
  discount: number | null;
  className: string | null;
  /** L'architecte a choisi d'afficher ses prix pro (vue « pro »). */
  show: boolean;
};

/**
 * Prix affiché dans le portail, choisi dans la barre du haut (Cyril,
 * 26/11/2026) : prix public HTVA, prix pro HTVA, ou prix public TVAC. Un
 * réglage de l'appareil : le devis et le PDF ne changent pas.
 */
export type PriceView = "htva" | "pro" | "tvac";
export const PRICE_VIEWS: PriceView[] = ["htva", "pro", "tvac"];
export const PRICE_VIEW_COOKIE = "prix_affiche";
/** Ancien interrupteur « Mes prix pro », relu pour ne pas perdre le choix. */
export const PRO_COOKIE = "prix_pro";
/** TVA du prix public affiché TVAC : le taux belge des meubles et luminaires. */
export const DISPLAY_VAT = 21;

export function readPriceView(cookieHeader: string | null): PriceView {
  const parts = (cookieHeader || "").split(/;\s*/);
  const raw = parts
    .find((p) => p.startsWith(`${PRICE_VIEW_COOKIE}=`))
    ?.slice(PRICE_VIEW_COOKIE.length + 1);
  if (raw && (PRICE_VIEWS as string[]).includes(raw)) return raw as PriceView;
  return parts.includes(`${PRO_COOKIE}=1`) ? "pro" : "htva";
}

export function withTax(cents: number, rate = DISPLAY_VAT) {
  return Math.round((cents * (100 + rate)) / 100);
}

/**
 * Prix catalogue (public HTVA) dans la vue choisie. Sans remise connue, la
 * vue pro garde le prix public et le dit.
 */
export function viewPrice(
  cents: number,
  view: PriceView,
  pro: ProPricing | null | undefined,
): { cents: number; kind: string; pending?: boolean } {
  if (view === "tvac") return { cents: withTax(cents), kind: "TVAC" };
  if (view === "pro" && pro) {
    if (pro.discount === null)
      return { cents, kind: "HTVA · prix pro à confirmer", pending: true };
    return { cents: proPrice(cents, pro.discount), kind: "HTVA · prix pro" };
  }
  return { cents, kind: "HTVA" };
}

export function proPrice(cents: number, discount: number) {
  return Math.round((cents * (100 - discount)) / 100);
}

/** Prix pro à afficher, ou null (option coupée, pas de remise connue). */
export function shownProPrice(pro: ProPricing | null | undefined, cents: number) {
  if (!pro?.show || pro.discount === null) return null;
  return proPrice(cents, pro.discount);
}

/** Prix public HTVA d'une ligne du catalogue, même si l'architecte a changé son prix. */
export function publicUnitPrice(l: {
  price: number;
  sourcePrice: number | null;
  sourceIncludesTax: boolean;
  sourceVatRate: number | null;
}) {
  if (l.sourcePrice === null) return l.price;
  return l.sourceIncludesTax && l.sourceVatRate
    ? Math.round(l.sourcePrice / (1 + l.sourceVatRate / 100))
    : l.sourcePrice;
}

type MerchLine = Parameters<typeof publicUnitPrice>[0] & {
  id: string;
  qty: number;
  chargePercent?: number | null;
};

/**
 * Marchandise du devis au prix public HTVA : produits retenus et options
 * cochées, comme la base de la livraison. Sans livraison ni prestations, qui
 * ne prennent pas la remise pro.
 */
export function publicMerchandise(s: {
  groups: { id: string; selected: string; items: MerchLine[] }[];
  extras: (MerchLine & { selected: boolean; parent?: string | null })[];
}) {
  const unit = (l: MerchLine) => publicUnitPrice(l) * l.qty;
  return (
    s.groups.reduce((n, g) => {
      const l = g.items.find((i) => i.id === g.selected);
      return n + (l ? unit(l) : 0);
    }, 0) +
    s.extras
      .filter(
        (e) =>
          e.selected &&
          (e.chargePercent ?? null) === null &&
          s.groups.some((g) => g.id === e.parent),
      )
      .reduce((n, e) => n + unit(e), 0)
  );
}

/** Ligne dont le prix vient du catalogue (prix Shopify connu et lisible). */
export function isCataloguePrice(l: Parameters<typeof publicUnitPrice>[0]) {
  return (
    l.sourcePrice !== null && (!l.sourceIncludesTax || l.sourceVatRate !== null)
  );
}

type PricedLine = Parameters<typeof publicUnitPrice>[0] & {
  discount: number;
  variantId: string | null;
  priceConfirmed: boolean;
};

/**
 * Compte architecte : il ne choisit pas les prix du catalogue (Cyril,
 * 26/11/2026). Les produits gardent le prix public de Shopify. La remise par
 * ligne reste : c'est la remise que l'architecte fait à son client, à lui de
 * voir, distincte de la remise de palier de Mikado Deco. Appliqué par le
 * serveur à chaque enregistrement.
 */
export function lockPrices<
  S extends { groups: { items: L[] }[]; extras: L[] },
  L extends PricedLine,
>(s: S): S {
  const lock = (l: L): L => {
    const catalogue = isCataloguePrice(l);
    return {
      ...l,
      ...(catalogue
        ? { price: publicUnitPrice(l), priceConfirmed: true }
        : {}),
    };
  };
  return {
    ...s,
    groups: s.groups.map((g) => ({ ...g, items: g.items.map(lock) })),
    extras: s.extras.map(lock),
  };
}
