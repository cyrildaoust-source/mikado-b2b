import {
  data,
  redirect,
  useLoaderData,
  useActionData,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "react-router";
import { context, ownerScope, requireAdmin } from "../services/context.server";
import {
  getQuote,
  assertQuoteAccess,
  saveQuote,
  createQuote,
  archiveQuote,
  markSent,
  unarchiveQuote,
  trashQuote,
  restoreTrashedQuote,
  restoreRevision,
} from "../services/quotes.server";
import {
  convertQuote,
  previewConversion,
  reconcile,
  publishQuote,
} from "../services/conversion.server";
import { quoteSchema, upgradeQuote } from "../domain/quote";
import { productsByIds } from "../services/shopify-api.server";
import { readForm } from "../services/form.server";
import { quotePdf } from "../services/pdf.server";
import { odooPublicUrl } from "../services/odoo.server";
import { acceptOrder } from "../services/order.server";
import {
  billingMode,
  preflightBilling,
  requestBilling,
  retryBilling,
  simulateBilling,
} from "../services/billing-v2.server";
import { billingKinds, type BillingKind } from "../domain/billing";
import { fiscalTotals } from "../domain/quote";
import Editor from "../components/Editor";
import { rememberQuote } from "../services/current-quote.server";
export async function loader({ request, params }: LoaderFunctionArgs) {
  const c = await context(request);
  await assertQuoteAccess(c.shop, Number(params.id), ownerScope(c));
  const q = await getQuote(c.shop, Number(params.id));
  // Ce devis devient le « devis ouvert » affiché à côté des fiches du catalogue.
  const headers = { "Set-Cookie": await rememberQuote(q.id) };
  return data({
    q,
    demo: c.demo,
    embedded: c.embedded,
    // Commande Shopify : réservée à l'administration de Mikado.
    admin: c.embedded || c.user?.role === "admin",
    shop: c.shop,
    actor: c.actor,
    billingMode: billingMode(c.shop),
    odooUrl: c.demo ? null : odooPublicUrl(),
  }, { headers });
}
export async function action({ request, params }: ActionFunctionArgs) {
  const c = await context(request),
    id = Number(params.id);
  await assertQuoteAccess(c.shop, id, ownerScope(c));
  if (Number(request.headers.get("content-length")) > 1000000)
    return { error: "Devis trop volumineux." };
  const form = await readForm(request),
    intent = String(form.get("intent")),
    version = Number(form.get("version"));
  // Commande Shopify et facturation : réservées à Mikado Deco, même par requête directe.
  if (
    ["accept-order", "billing-request", "billing-retry", "billing-simulate", "preview", "convert", "reconcile"].includes(intent)
  )
    requireAdmin(c);
  try {
    if (intent === "accept-order") {
      await preflightBilling(c.shop, id);
      await acceptOrder(c.shop, id, version, c.admin);
      const q = await getQuote(c.shop, id);
      if (fiscalTotals(quoteSchema.parse(JSON.parse(q.state))).deposit)
        await requestBilling(c.shop, id, "deposit", c.actor);
      return {
        ok: c.demo
          ? "Commande simulée. Demande d’acompte enregistrée."
          : "Commande confirmée. Demande d’acompte enregistrée.",
      };
    }
    if (intent === "billing-request") {
      const kind = String(form.get("kind")) as BillingKind;
      if (!billingKinds.includes(kind)) throw Error("Échéance inconnue.");
      await requestBilling(
        c.shop,
        id,
        kind,
        c.actor,
        form.get("milestoneConfirmed") === "true",
      );
      return { ok: "Demande de brouillon Odoo enregistrée." };
    }
    if (intent === "billing-retry") {
      await retryBilling(c.shop, id, String(form.get("requestId")));
      return { ok: "Demande remise en attente." };
    }
    if (intent === "billing-simulate") {
      await simulateBilling(c.shop, id, String(form.get("stage")));
      return { ok: "Étape Odoo simulée. Aucun paiement réel." };
    }
    if (intent === "trash") {
      await trashQuote(c.shop, id, version);
      return redirect("/app?status=deleted");
    }
    if (intent === "restore-trash") {
      await restoreTrashedQuote(c.shop, id, version);
      return { ok: "Devis restauré depuis la corbeille." };
    }
    if (intent === "unarchive") {
      await unarchiveQuote(c.shop, id, version);
      return { ok: "Devis restauré." };
    }
    if (intent === "prepare" || intent === "refresh-pdf") {
      const raw = intent === "refresh-pdf"
        ? (await getQuote(c.shop, id)).state
        : String(form.get("state"));
      if (raw.length > 1000000) throw Error("Devis trop volumineux.");
      const state = quoteSchema.parse(JSON.parse(raw));
      if (!state.client.trim())
        throw Error("Choisissez un client avant de préparer le PDF.");
      const v = await saveQuote(c.shop, id, version, state, intent === "refresh-pdf");
      await publishQuote(c.shop, id, v, c.admin);
      await quotePdf(c.shop, id, v);
      return {
        ok: "Votre PDF est prêt. La version est conservée dans l’historique.",
      };
    }
    if (intent === "photos") {
      const q = await getQuote(c.shop, id);
      if (q.version !== version || q.status !== "draft") throw Error("Rechargez le devis avant de compléter ses photos.");
      const state = quoteSchema.parse(JSON.parse(q.state));
      const lines = [...state.groups.flatMap(g => g.items), ...state.extras];
      const ids = [...new Set(lines.filter(l => !l.image && l.variantId).map(l => l.variantId!))];
      const photos = new Map<string, string>();
      for (let start = 0; start < ids.length; start += 100) {
        const result = await productsByIds(c.admin, ids.slice(start, start + 100));
        for (const item of result.items) photos.set(item.variantId!, item.image);
      }
      let count = 0;
      for (const line of lines) {
        const photo = line.variantId && photos.get(line.variantId);
        if (!line.image && photo) { line.image = photo; count++; }
      }
      if (count) await saveQuote(c.shop, id, version, state);
      return { ok: count ? `${count} photo(s) ajoutée(s). Préparez un nouveau PDF pour les inclure.` : "Aucune photo supplémentaire disponible dans Shopify." };
    }
    if (intent === "save") {
      const raw = String(form.get("state"));
      if (raw.length > 1000000) throw Error("Devis trop volumineux.");
      await saveQuote(c.shop, id, version, JSON.parse(raw));
      return { ok: "Devis enregistré." };
    }
    if (intent === "duplicate") {
      const q = await getQuote(c.shop, id);
      const state = quoteSchema.parse(JSON.parse(q.state));
      const q2 = await createQuote(
        c.shop,
        state.schemaVersion === 1 ? upgradeQuote(state) : state,
        c.user?.id || null,
      );
      return redirect(`/app/quotes/${q2.id}`);
    }
    if (intent === "publish") {
      await publishQuote(c.shop, id, version, c.admin);
      return { ok: "Révision figée. Son PDF est disponible." };
    }
    if (intent === "sent") {
      await markSent(c.shop, id, version);
      return { ok: "Envoi déclaré." };
    }
    if (intent === "restore") {
      await restoreRevision(
        c.shop,
        id,
        version,
        Number(form.get("sourceVersion")),
      );
      return { ok: "Ancienne sauvegarde reprise dans un nouveau brouillon." };
    }
    if (intent === "archive") {
      await archiveQuote(c.shop, id, version);
      return redirect("/app");
    }
    if (intent === "preview") {
      await previewConversion(c.shop, id, version, c.admin);
      return { ok: "Calcul terminé. Vérifiez les montants avant création." };
    }
    if (intent === "convert") {
      await convertQuote(c.shop, id, version, c.admin);
      return { ok: "Commande provisoire créée." };
    }
    if (intent === "reconcile") {
      await reconcile(c.shop, id, c.admin);
      return { ok: "Commande retrouvée." };
    }
    return { error: "Action inconnue." };
  } catch (e) {
    if (e instanceof Response) throw e;
    return {
      error:
        e instanceof Error
          ? e.name === "ZodError"
            ? "Vérifiez les champs du devis."
            : e.message
          : "Action impossible.",
    };
  }
}
export default function Quote() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  return (
    <Editor key={`${data.q.id}-${data.q.version}`} {...data} result={result} />
  );
}
