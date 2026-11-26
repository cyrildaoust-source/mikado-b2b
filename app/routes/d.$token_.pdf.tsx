import type { LoaderFunctionArgs } from "react-router";
import { sharePdf } from "../services/share.server";

/** PDF de la proposition, servi par le même lien secret. */
export async function loader({ params }: LoaderFunctionArgs) {
  const pdf = await sharePdf(String(params.token));
  if (!pdf)
    return new Response("Proposition indisponible", {
      status: 404,
      headers: { "Cache-Control": "private, no-store" },
    });
  return new Response(new Uint8Array(pdf.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${pdf.name.replace(/[^\w.-]/g, "_")}"`,
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
