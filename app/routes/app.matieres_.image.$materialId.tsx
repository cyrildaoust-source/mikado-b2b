import type { LoaderFunctionArgs } from "react-router";
import { context } from "../services/context.server";
import { getLibraryImage } from "../services/library.server";

/** Photo d'une matière de la bibliothèque, pour toute personne connectée à l'outil. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  await context(request);
  const img = await getLibraryImage(String(params.materialId));
  if (!img) throw new Response("Matière introuvable", { status: 404 });
  return new Response(new Uint8Array(img.data), {
    headers: {
      "Content-Type": img.mime,
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
