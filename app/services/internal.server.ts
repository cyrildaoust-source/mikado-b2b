import { timingSafeEqual } from "node:crypto";

/**
 * Accès aux routes /internal/* de remplissage de la bibliothèque.
 * Deux portes : le jeton serveur INTERNAL_TOKEN (32 caractères ou plus) dans
 * « Authorization: Bearer … », ou une session admin de l'outil pro (ouverture
 * dans le navigateur de Mikado Deco). Sans jeton configuré ni session admin,
 * la route répond 404, comme si elle n'existait pas.
 */
export function sameSecret(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function bearerOk(
  request: Request,
  secret: string | undefined,
  min = 32,
) {
  const s = secret || "";
  if (s.length < min) return false;
  return sameSecret(request.headers.get("authorization") || "", `Bearer ${s}`);
}

export async function requireInternal(request: Request) {
  if (bearerOk(request, process.env.INTERNAL_TOKEN)) return;
  const { isStandalone } = await import("./mode.server");
  if (isStandalone()) {
    const { currentUser } = await import("./auth.server");
    const user = await currentUser(request);
    if (user?.role === "admin") return;
  }
  throw new Response("Introuvable", {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}
