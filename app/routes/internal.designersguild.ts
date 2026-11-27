import type { LoaderFunctionArgs } from "react-router";
import { requireInternal } from "../services/internal.server";
import { DG_KINDS, type DgKind } from "../domain/designersguild";
import { importDesignersGuild } from "../services/library.server";

/*
 * Remplissage de la bibliothèque avec le catalogue Designers Guild.
 * GET /internal/designersguild?kind=fabric|wallpaper&from=<n>[&dry=1] : 800 coloris à partir du n-ième.
 * Une photo déjà connue est mise à jour, jamais doublée. L'hôte est fixe.
 */
export const config = { maxDuration: 300 };

export async function loader({ request }: LoaderFunctionArgs) {
  await requireInternal(request);
  const url = new URL(request.url);
  const headers = { "Cache-Control": "no-store" };
  const kind = url.searchParams.get("kind") as DgKind;
  const from = Number(url.searchParams.get("from") || "0");
  if (!DG_KINDS.includes(kind) || !Number.isInteger(from) || from < 0) {
    return Response.json({ error: "Paramètres invalides." }, { status: 400, headers });
  }
  try {
    return Response.json(await importDesignersGuild(kind, from, 800, url.searchParams.get("dry") === "1"), { headers });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Import impossible." }, { status: 502, headers });
  }
}
