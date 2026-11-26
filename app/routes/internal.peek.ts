import type { LoaderFunctionArgs } from "react-router";

/*
 * Lecture d'une page publique d'éditeur pour préparer un import de coloris.
 * Hôtes fixes, chemin seul, aucune écriture : renvoie le statut, les images,
 * quelques liens et le début de la page.
 */
const SITES: Record<string, string> = {
  pierrefrey: "https://www.pierrefrey.com",
  designersguild: "https://www.designersguild.com",
  elitis: "https://www.elitis.fr",
};

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const headers = { "Cache-Control": "no-store" };
  const base = SITES[url.searchParams.get("site") || ""];
  const path = url.searchParams.get("path") || "/";
  if (!base || !/^\/[\w\-./%?=&]*$/.test(path) || path.includes("//")) {
    return Response.json({ error: "Site ou chemin invalide." }, { status: 400, headers });
  }
  try {
    const r = await fetch(base + path, {
      headers: { "User-Agent": "MikadoDecoPro/1.0 (bibliotheque de matieres)", Accept: "text/html,application/xml;q=0.9,*/*;q=0.5" },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
    const text = await r.text();
    const images = [...new Set(text.match(/https?:\\?\/\\?\/[^"'\s)<>]+?\.(?:jpe?g|png|webp)(?:\?[^"'\s)<>]*)?/gi) || [])];
    const links = [...new Set([...text.matchAll(/href="([^"#]+)"/g)].map((m) => m[1]))];
    const find = url.searchParams.get("find");
    const at = find ? text.indexOf(find) : -1;
    return Response.json(
      {
        status: r.status,
        finalUrl: r.url,
        type: r.headers.get("content-type"),
        bytes: text.length,
        images: images.slice(0, 40),
        imageCount: images.length,
        links: links.slice(0, 80),
        linkCount: links.length,
        head: text.slice(0, 1500),
        around: at >= 0 ? text.slice(Math.max(0, at - 800), at + 800) : null,
      },
      { headers },
    );
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Lecture impossible." }, { status: 502, headers });
  }
}
