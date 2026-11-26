import type { LoaderFunctionArgs } from "react-router";
import { context, requireAdmin } from "../services/context.server";

/*
 * Pack d'images basse résolution d'un produit Kvadrat, tel que la fiche
 * publique le propose (« Download all images »). Relais sans stockage : le
 * navigateur de Cyril ouvre l'archive, il vérifie la liste, puis l'outil
 * range les photos dans la bibliothèque. Accord de Cyril, partenaire
 * Kvadrat, le 26/11/2026. Une requête par clic.
 */
const PACK = "https://kvadrat-downloadcenter.azurewebsites.net/api/downloadcenter/downloadimages/";
const MAX = 80_000_000;

export async function loader({ request, params }: LoaderFunctionArgs) {
  const c = await context(request);
  requireAdmin(c);
  const product = String(params.product);
  if (!/^\d{1,6}$/.test(product)) return new Response("Numéro de produit invalide.", { status: 400 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50_000);
  try {
    const r = await fetch(`${PACK}${product}?culture=en&lowResolution=true`, {
      signal: controller.signal,
      headers: { "User-Agent": "MikadoDecoPro/1.0 (bibliotheque de matieres)" },
    });
    const size = Number(r.headers.get("content-length") || 0);
    if (!r.ok || !r.body) return new Response(`Kvadrat ne fournit pas de pack pour le produit ${product}.`, { status: 502 });
    if (size > MAX) return new Response("Pack d'images trop lourd.", { status: 413 });
    return new Response(r.body, {
      headers: {
        "Content-Type": "application/zip",
        ...(size ? { "Content-Length": String(size) } : {}),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Kvadrat ne répond pas. Réessayez dans un moment.", { status: 504 });
  } finally {
    clearTimeout(timer);
  }
}
