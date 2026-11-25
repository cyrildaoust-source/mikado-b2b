import { timingSafeEqual } from "node:crypto";
import { redirect, type LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { isStandalone } from "../services/mode.server";
import { createInvite, normalizeEmail } from "../services/auth.server";

// Premier accès Mikado Deco sur une base vide, sans terminal : ouvrir
// /premier-acces?jeton=<BOOTSTRAP_TOKEN>. Ne fait plus rien dès qu'un accès existe.
function sameSecret(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (!isStandalone()) throw redirect("/app");
  const expected = process.env.BOOTSTRAP_TOKEN || "",
    email = normalizeEmail(process.env.BOOTSTRAP_ADMIN_EMAIL || ""),
    supplied = new URL(request.url).searchParams.get("jeton") || "";
  if (expected.length < 32 || !email || !sameSecret(supplied, expected))
    throw new Response("Introuvable", { status: 404 });
  if ((await db.user.count()) > 0) throw redirect("/connexion");
  const user = await db.user.create({
    data: { email, name: "Mikado Deco", role: "admin" },
  });
  return redirect(`/invitation/${await createInvite(user.id)}`);
}

export default function PremierAcces() {
  return null;
}
