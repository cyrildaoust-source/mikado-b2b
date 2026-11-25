/** Mode autonome : l'outil pro tourne hors de l'admin Shopify, avec ses propres comptes. */
export function isStandalone() {
  return process.env.APP_MODE === "standalone";
}
