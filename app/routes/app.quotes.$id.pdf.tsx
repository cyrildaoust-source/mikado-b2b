import type { ActionFunctionArgs } from "react-router";
import { context } from "../services/context.server";
import { quotePdf } from "../services/pdf.server";
export async function action({ request, params }: ActionFunctionArgs) {
  const c = await context(request);
  const body = await request.formData();
  const id = Number(params.id),
    version = Number(body.get("version"));
  if (
    !Number.isSafeInteger(id) ||
    !Number.isSafeInteger(version) ||
    version < 1
  )
    throw new Response("Version invalide", { status: 400 });
  const pdf = await quotePdf(c.shop, id, version);
  return new Response(new Uint8Array(pdf.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${pdf.number}-${pdf.fileVersion}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
