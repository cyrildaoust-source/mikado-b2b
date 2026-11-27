import type { LoaderFunctionArgs } from "react-router";
import { requireInternal } from "../services/internal.server";
import db from "../db.server";
import { importKvadratProduct } from "../services/library.server";
import { KVADRAT_PRODUCTS } from "../domain/kvadrat-products";

/*
 * Remplissage de la bibliothèque avec les tissus Kvadrat de la liste
 * (app/domain/kvadrat-products.ts), un produit par appel. Sans effet pour un
 * produit hors liste ou déjà importé : l'appel ne peut rien faire d'autre.
 * GET /internal/kvadrat?product=1000[&dry=1]
 */

/** Un pack Kvadrat peut peser quelques dizaines de Mo : plus de temps que la valeur par défaut. */
export const config = { maxDuration: 300 };

export async function loader({ request }: LoaderFunctionArgs) {
  await requireInternal(request);
  const url = new URL(request.url);
  const p = KVADRAT_PRODUCTS.find((x) => x.number === url.searchParams.get("product"));
  if (!p) return Response.json({ error: "Produit hors de la liste Kvadrat." }, { status: 404 });
  const headers = { "Cache-Control": "no-store" };
  const dry = url.searchParams.get("dry") === "1";
  if (!dry) {
    const already = await db.libraryMaterial.count({ where: { maker: "Kvadrat", collection: p.name } });
    if (already) return Response.json({ product: p.number, collection: p.name, already }, { headers });
  }
  try {
    return Response.json(await importKvadratProduct(p.number, p.name, dry), { headers });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Import impossible." }, { status: 502, headers });
  }
}
