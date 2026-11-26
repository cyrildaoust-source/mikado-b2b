import type { ActionFunctionArgs } from "react-router";
import { context, ownerScope } from "../services/context.server";
import { assertQuoteAccess, getQuote } from "../services/quotes.server";
import {
  addUpload,
  deleteUpload,
  MAX_UPLOAD,
  saveMood,
} from "../services/moodboard.server";

/** Enregistrement du mood board et photos ajoutées (réponses JSON). */
export async function action({ request, params }: ActionFunctionArgs) {
  const c = await context(request);
  const id = Number(params.id);
  await assertQuoteAccess(c.shop, id, ownerScope(c));
  const q = await getQuote(c.shop, id);
  if (q.status === "deleted")
    return Response.json({ error: "Ce devis est à la corbeille." }, { status: 409 });
  if (Number(request.headers.get("content-length")) > MAX_UPLOAD + 200_000)
    return Response.json({ error: "Envoi trop volumineux." }, { status: 413 });
  try {
    const form = await request.formData();
    const intent = String(form.get("intent"));
    if (intent === "save") {
      await saveMood(id, JSON.parse(String(form.get("state"))));
      return Response.json({ ok: true });
    }
    if (intent === "upload") {
      const file = form.get("file");
      if (!(file instanceof File)) throw Error("Aucune photo reçue.");
      return Response.json({ upload: await addUpload(id, file) });
    }
    if (intent === "delete-upload") {
      await deleteUpload(id, String(form.get("upload")));
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Action inconnue." }, { status: 400 });
  } catch (e) {
    if (e instanceof Response) throw e;
    return Response.json(
      {
        error:
          e instanceof Error
            ? e.name === "ZodError"
              ? "Planche illisible. Rechargez la page."
              : e.message
            : "Action impossible.",
      },
      { status: 400 },
    );
  }
}
