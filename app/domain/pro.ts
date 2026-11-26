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
  /** L'architecte a choisi d'afficher ses prix pro. */
  show: boolean;
};

export const PRO_COOKIE = "prix_pro";

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
