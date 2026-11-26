import type { Context } from "./context.server";
import { architectStatus, listClasses } from "./classes.server";
import { memo } from "./memo.server";
import { PRO_COOKIE, type ProPricing } from "../domain/pro";

export function showProCookie(request: Request) {
  const raw = request.headers.get("cookie") || "";
  return raw.split(/;\s*/).includes(`${PRO_COOKIE}=1`);
}

/**
 * Remise pro du compte connecté. Architecte : la classe de son tableau de bord.
 * Démo : la plus petite classe à remise non nulle, pour voir le rendu.
 * Mikado Deco et l'admin Shopify : rien, ils voient le prix public.
 */
export async function proPricing(
  request: Request,
  c: Context,
): Promise<ProPricing | null> {
  if (c.embedded) return null;
  const show = showProCookie(request);
  if (c.demo) {
    const cls = (await listClasses())
      .filter((k) => k.discount > 0)
      .sort((a, b) => a.discount - b.discount)[0];
    return {
      discount: cls?.discount ?? null,
      className: cls?.name ?? null,
      show,
    };
  }
  if (!c.user || c.user.role === "admin") return null;
  const user = c.user;
  // Le chiffre des 12 mois change peu : une minute de cache par compte.
  const status = await memo(`pro:${c.shop}:${user.id}`, 60_000, () =>
    architectStatus(c.shop, user.id),
  );
  const cur = status?.current;
  return {
    discount: cur ? cur.discount : null,
    className: cur ? cur.name : null,
    show,
  };
}
