import type { LoaderFunctionArgs } from "react-router";
import { context, ownerScope } from "../services/context.server";
import { assertQuoteAccess } from "../services/quotes.server";
import { getUpload } from "../services/moodboard.server";

/** Photo ajoutée au mood board, visible des seules personnes qui voient le devis. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const c = await context(request);
  const id = Number(params.id);
  await assertQuoteAccess(c.shop, id, ownerScope(c));
  const img = await getUpload(id, String(params.imageId));
  if (!img) throw new Response("Photo introuvable", { status: 404 });
  return new Response(new Uint8Array(img.data), {
    headers: {
      "Content-Type": img.mime,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
