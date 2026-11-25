/** Demande au CDN Shopify une image à la bonne largeur ; laisse les autres adresses intactes. */
export function sized(url: string, width: number) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.hostname !== "cdn.shopify.com") return url;
    u.searchParams.set("width", String(width));
    return u.toString();
  } catch {
    return url;
  }
}
