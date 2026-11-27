import type { LoaderFunctionArgs } from "react-router";
import { requireInternal } from "../services/internal.server";
import { DEDAR_SLUG } from "../domain/dedar";
import { dedarSlugs, importDedarBatch, importDedarProduct } from "../services/library.server";

/*
 * Remplissage de la bibliothèque avec les coloris Dedar, une fiche par appel.
 * GET /internal/dedar?list=1 : fiches du plan du site.
 * GET /internal/dedar?product=<slug>[&dry=1] : une fiche.
 * GET /internal/dedar?from=<n> : 40 fiches du plan à partir de la n-ième.
 * Une vignette déjà connue est mise à jour, jamais doublée. L'hôte est fixe,
 * l'appel ne peut rien faire d'autre.
 */
export const config = { maxDuration: 300 };

export async function loader({ request }: LoaderFunctionArgs) {
  await requireInternal(request);
  const url = new URL(request.url);
  const headers = { "Cache-Control": "no-store" };
  try {
    if (url.searchParams.get("list") === "1") return Response.json({ products: await dedarSlugs() }, { headers });
    const from = url.searchParams.get("from");
    if (from !== null) {
      const n = Number(from);
      if (!Number.isInteger(n) || n < 0) return Response.json({ error: "Départ invalide." }, { status: 400, headers });
      return Response.json(await importDedarBatch(n, 40), { headers });
    }
    const slug = url.searchParams.get("product") || "";
    if (!DEDAR_SLUG.test(slug)) return Response.json({ error: "Fiche Dedar invalide." }, { status: 400, headers });
    const dry = url.searchParams.get("dry") === "1";
    return Response.json(await importDedarProduct(slug, dry), { headers });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Import impossible." }, { status: 502, headers });
  }
}
