import type { LoaderFunctionArgs } from "react-router";
import { RUBELLI_SLUG } from "../domain/rubelli";
import { importRubelliPage, importRubelliProduct } from "../services/library.server";

/*
 * Remplissage de la bibliothèque avec les coloris Rubelli.
 * GET /internal/rubelli?page=<n>[&dry=1] : les fiches d'une page de la liste « textiles ».
 * GET /internal/rubelli?product=<slug>[&dry=1] : une fiche.
 * Une photo déjà connue est mise à jour, jamais doublée. L'hôte est fixe,
 * l'appel ne peut rien faire d'autre.
 */
export const config = { maxDuration: 300 };

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const headers = { "Cache-Control": "no-store" };
  const dry = url.searchParams.get("dry") === "1";
  try {
    const page = url.searchParams.get("page");
    if (page !== null) {
      const n = Number(page);
      if (!Number.isInteger(n) || n < 1 || n > 200) return Response.json({ error: "Page invalide." }, { status: 400, headers });
      return Response.json(await importRubelliPage(n, dry), { headers });
    }
    const slug = url.searchParams.get("product") || "";
    if (!RUBELLI_SLUG.test(slug)) return Response.json({ error: "Fiche Rubelli invalide." }, { status: 400, headers });
    return Response.json(await importRubelliProduct(slug, dry), { headers });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Import impossible." }, { status: 502, headers });
  }
}
