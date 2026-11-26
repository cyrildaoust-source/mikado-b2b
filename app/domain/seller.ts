/** Émetteur figé sur une révision : Mikado Deco, ou le cabinet de l'architecte. */
export type Seller = {
  name: string;
  address: string;
  email: string;
  website: string;
  vat: string;
  phone?: string;
  /** Logo du cabinet en data URL (PNG, JPEG ou WebP), figé avec la révision. */
  logo?: string;
  kind?: "mikado" | "firm";
  template?: string;
};

const MIKADO = {
  address: "Rue du Doyenné 75",
  email: "shop@mikadodeco.be",
  website: "www.mikadodeco.be",
};

/**
 * Adresse et coordonnées à imprimer. Les valeurs de Mikado Deco ne servent que
 * pour un ancien devis sans émetteur : un cabinet sans e-mail n'affiche pas
 * celui de Mikado Deco.
 */
export function sellerLines(seller?: Seller | null) {
  if (!seller)
    return { address: MIKADO.address, contact: [MIKADO.email, MIKADO.website] };
  const firm = seller.kind === "firm";
  const pick = (v: string | undefined, fallback: string) =>
    firm ? (v || "").trim() : v || fallback;
  return {
    address: pick(seller.address, MIKADO.address),
    contact: [
      firm ? (seller.phone || "").trim() : "",
      pick(seller.email, MIKADO.email),
      pick(seller.website, MIKADO.website),
    ].filter(Boolean),
  };
}

/** Logo accepté seulement en data URL d'image matricielle (pas de SVG). */
export function safeLogo(src?: string | null) {
  return src && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(src)
    ? src
    : undefined;
}
