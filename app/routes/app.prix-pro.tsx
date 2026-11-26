import { redirect, type ActionFunctionArgs } from "react-router";
import { context } from "../services/context.server";
import { safeNext } from "../services/auth.server";
import { PRO_COOKIE } from "../domain/pro";

/** Bascule « Afficher mes prix pro » : un cookie de l'appareil, un an. */
export async function action({ request }: ActionFunctionArgs) {
  await context(request);
  const form = await request.formData();
  const on = form.get("show") === "1";
  const next = safeNext(String(form.get("next") || "/app"));
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return redirect(next, {
    headers: {
      "Set-Cookie": `${PRO_COOKIE}=${on ? "1" : "0"}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly${secure}`,
    },
  });
}
export function loader() {
  return redirect("/app");
}
