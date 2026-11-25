import { timingSafeEqual } from "node:crypto";
import { redirect, type LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { isStandalone } from "../services/mode.server";
import { createInvite, normalizeEmail } from "../services/auth.server";

// Premier accès Mikado Deco sans terminal : ouvrir /premier-acces?jeton=<BOOTSTRAP_TOKEN>.
// Base vide : crée l'accès admin de BOOTSTRAP_ADMIN_EMAIL. Ensuite, la même adresse
// sert de secours : elle donne à cet accès admin un lien pour choisir un nouveau mot
// de passe. Retirer BOOTSTRAP_TOKEN de Vercel ferme la page.
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
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    if (!existing.active || existing.role !== "admin")
      throw redirect("/connexion");
    return redirect(`/invitation/${await createInvite(existing.id)}`);
  }
  if ((await db.user.count()) > 0) throw redirect("/connexion");
  const user = await db.user.create({
    data: { email, name: "Mikado Deco", role: "admin" },
  });
  return redirect(`/invitation/${await createInvite(user.id)}`);
}

export default function PremierAcces() {
  return null;
}
