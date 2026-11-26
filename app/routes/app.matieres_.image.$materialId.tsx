import type { LoaderFunctionArgs } from "react-router";
import { context } from "../services/context.server";
import { LIBRARY_WIDTHS, getLibraryImage, getLibraryImageSized } from "../services/library.server";

/** Photo d'une matière de la bibliothèque, pour toute personne connectée à l'outil. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  await context(request);
  const w = Number(new URL(request.url).searchParams.get("w"));
  const id = String(params.materialId);
  const img = (LIBRARY_WIDTHS as readonly number[]).includes(w) ? await getLibraryImageSized(id, w) : await getLibraryImage(id);
  if (!img) throw new Response("Matière introuvable", { status: 404 });
  return new Response(new Uint8Array(img.data), {
    headers: {
      "Content-Type": img.mime,
      "Cache-Control": "private, max-age=604800",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
