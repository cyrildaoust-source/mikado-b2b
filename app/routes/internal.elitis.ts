import type { LoaderFunctionArgs } from "react-router";
import { elitisMissing, importElitis } from "../services/library.server";

/*
 * Remplissage de la bibliothèque avec le catalogue Élitis.
 * GET /internal/elitis?from=<n>[&count=<k>][&dry=1] : k collections (40 par défaut) à partir de la n-ième.
 * GET /internal/elitis?missing=1 : collections encore absentes.
 * Une photo déjà connue est mise à jour, jamais doublée. L'hôte est fixe.
 */
export const config = { maxDuration: 300 };

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const headers = { "Cache-Control": "no-store" };
  const from = Number(url.searchParams.get("from") || "0");
  const count = Number(url.searchParams.get("count") || "40");
  if (!Number.isInteger(from) || from < 0 || !Number.isInteger(count) || count < 1 || count > 80) {
    return Response.json({ error: "Paramètres invalides." }, { status: 400, headers });
  }
  try {
    if (url.searchParams.get("missing") === "1") return Response.json(await elitisMissing(), { headers });
    return Response.json(await importElitis(from, count, url.searchParams.get("dry") === "1"), { headers });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Import impossible." }, { status: 502, headers });
  }
}
