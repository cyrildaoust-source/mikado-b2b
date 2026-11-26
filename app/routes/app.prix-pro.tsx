import { redirect, type ActionFunctionArgs } from "react-router";
import { context } from "../services/context.server";
import { safeNext } from "../services/auth.server";
import { PRICE_VIEW_COOKIE, PRICE_VIEWS, PRO_COOKIE, type PriceView } from "../domain/pro";

/** Prix affiché (HTVA, pro, TVAC) : un cookie de l'appareil, un an. */
export async function action({ request }: ActionFunctionArgs) {
  await context(request);
  const form = await request.formData();
  const raw = String(form.get("view") || "");
  const view: PriceView = (PRICE_VIEWS as string[]).includes(raw)
    ? (raw as PriceView)
    : "htva";
  const next = safeNext(String(form.get("next") || "/app"));
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    `${PRICE_VIEW_COOKIE}=${view}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly${secure}`,
  );
  // L'ancien interrupteur ne doit plus décider à la place du sélecteur.
  headers.append(
    "Set-Cookie",
    `${PRO_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly${secure}`,
  );
  return redirect(next, { headers });
}
export function loader() {
  return redirect("/app");
}
