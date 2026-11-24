export function sellerSnapshot() {
  return {
    name: process.env.SELLER_NAME || "Mikado Deco",
    address: process.env.SELLER_ADDRESS || "Rue du Doyenné 75",
    email: process.env.SELLER_EMAIL || "shop@mikadodeco.be",
    website: process.env.SELLER_WEBSITE || "shop.mikadodeco.be",
    vat: process.env.SELLER_VAT || "",
    template: "b2b-v3",
  };
}
