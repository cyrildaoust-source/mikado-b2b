import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { DEDAR_SLUG } from "../domain/dedar";
import { dedarSlugs, importDedarProduct } from "../services/library.server";

/*
 * Remplissage de la bibliothèque avec les coloris Dedar, une fiche par appel.
 * GET /internal/dedar?list=1 : fiches du plan du site.
 * GET /internal/dedar?product=<slug>[&dry=1] : sans effet pour une fiche déjà
 * importée ; l'hôte est fixe, l'appel ne peut rien faire d'autre.
 */
export const config = { maxDuration: 300 };

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const headers = { "Cache-Control": "no-store" };
  try {
    if (url.searchParams.get("list") === "1") return Response.json({ products: await dedarSlugs() }, { headers });
    const slug = url.searchParams.get("product") || "";
    if (!DEDAR_SLUG.test(slug)) return Response.json({ error: "Fiche Dedar invalide." }, { status: 400, headers });
    const dry = url.searchParams.get("dry") === "1";
    if (!dry) {
      const done = await db.libraryMaterial.count({ where: { maker: "Dedar", collection: { equals: slug.replace(/-/g, " "), mode: "insensitive" } } });
      if (done) return Response.json({ product: slug, already: done }, { headers });
    }
    return Response.json(await importDedarProduct(slug, dry), { headers });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Import impossible." }, { status: 502, headers });
  }
}
