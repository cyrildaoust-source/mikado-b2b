import type { LoaderFunctionArgs } from "react-router";
import { nuxt2State } from "../domain/nuxt2";

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
    const code = url.searchParams.get("code");
    let nuxt: unknown = undefined;
    if (url.searchParams.get("nuxt")) {
      const state = nuxt2State(text);
      const pattern = new RegExp(code || "^[A-Z]{1,4}_\\d+_\\d+$");
      const hits: unknown[] = [];
      let count = 0;
      const seen = new Set<unknown>();
      const walk = (v: unknown, path: string) => {
        if (!v || typeof v !== "object" || seen.has(v)) return;
        seen.add(v);
        const o = v as Record<string, unknown>;
        if (typeof o.code === "string" && pattern.test(o.code)) {
          count++;
          if (hits.length < 4) hits.push({ path, value: shape(o, 3) });
        }
        for (const [k, child] of Object.entries(o)) walk(child, `${path}.${k}`);
      };
      walk(state, "$");
      nuxt = { parsed: !!state, top: state ? shape(state, 2) : null, count, hits };
    }
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
        nuxt,
        around: at >= 0 ? text.slice(Math.max(0, at - 800), at + 800) : null,
      },
      { headers },
    );
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Lecture impossible." }, { status: 502, headers });
  }
}

/** Aperçu tronqué d'une valeur, pour voir la forme des données. */
function shape(v: unknown, depth: number): unknown {
  if (Array.isArray(v)) return depth <= 0 ? `[${v.length}]` : [v.length, ...v.slice(0, 2).map((x) => shape(x, depth - 1))];
  if (v && typeof v === "object") {
    if (depth <= 0) return `{${Object.keys(v).slice(0, 12).join(",")}}`;
    return Object.fromEntries(Object.entries(v).slice(0, 40).map(([k, x]) => [k, shape(x, depth - 1)]));
  }
  return typeof v === "string" && v.length > 200 ? v.slice(0, 200) + "…" : v;
}
