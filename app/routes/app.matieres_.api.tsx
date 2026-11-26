import type { ActionFunctionArgs } from "react-router";
import { context, requireAdmin } from "../services/context.server";
import { addLibrary, deleteLibrary, updateLibrary } from "../services/library.server";
import { LIBRARY_MAX_BYTES } from "../domain/library";

/** Bibliothèque de matières : ajout, correction et retrait (réponses JSON, Mikado Deco seul). */
export async function action({ request }: ActionFunctionArgs) {
  const c = await context(request);
  requireAdmin(c);
  if (Number(request.headers.get("content-length")) > LIBRARY_MAX_BYTES + 200_000)
    return Response.json({ error: "Envoi trop volumineux." }, { status: 413 });
  try {
    const form = await request.formData();
    const intent = String(form.get("intent"));
    const fields = {
      maker: form.get("maker"),
      collection: form.get("collection"),
      colour: form.get("colour"),
    };
    if (intent === "add") {
      const file = form.get("file");
      if (!(file instanceof File)) throw Error("Aucune photo reçue.");
      return Response.json({ material: await addLibrary({ ...fields, file }) });
    }
    if (intent === "update")
      return Response.json({ material: await updateLibrary(String(form.get("id")), fields) });
    if (intent === "delete") {
      await deleteLibrary(form.getAll("id").map(String));
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Action inconnue." }, { status: 400 });
  } catch (e) {
    if (e instanceof Response) throw e;
    return Response.json(
      { error: e instanceof Error ? e.message : "Action impossible." },
      { status: 400 },
    );
  }
}
