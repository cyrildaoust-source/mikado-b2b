import db from "../db.server";
import { lockPrices } from "../domain/pro";
import {
  data,
  redirect,
  useLoaderData,
  useActionData,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "react-router";
import { context, isExternal, ownerScope, requireAdmin } from "../services/context.server";
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
import {
  CatalogueBrowser,
  type CatalogueTarget,
} from "../components/quote/CatalogueBrowser";
import { useEffect, useRef, useState } from "react";
import { useFetchers } from "react-router";
import { rememberQuote } from "../services/current-quote.server";
import {
  currentDecision,
  reopenDecision,
  signDecision,
} from "../services/decision.server";
import {
  activeShare,
  createShare,
  revokeShares,
} from "../services/share.server";

export const meta = ({ data }: { data?: { q?: { number: string } } }) => [
  { title: `${data?.q?.number || "Devis"} · Mikado Deco Pro` },
];
export async function loader({ request, params }: LoaderFunctionArgs) {
  const c = await context(request);
  await assertQuoteAccess(c.shop, Number(params.id), ownerScope(c));
  const full = await getQuote(c.shop, Number(params.id));
  // Chaque enregistrement automatique ajoute une version : la page ne reçoit
  // que les 20 dernières et celles qui portent un PDF ou une révision, pour
  // que le rechargement après chaque enregistrement reste léger.
  const q = {
    ...full,
    revisions: full.revisions.filter(
      (r, i) => i < 20 || r.publishedNumber || r.pdfGeneratedAt,
    ),
  };
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
    share: await activeShare(q.id),
    decision: await currentDecision(q.id),
    signerName: c.user?.name ?? "",
    canSign: await canSignQuote(q.ownerId, c),
  }, { headers });
}
/** Qui signe : l'utilisateur connecté, ou l'admin Shopify / la démo (null). */
const signer = (c: Awaited<ReturnType<typeof context>>) =>
  c.user ? { id: c.user.id, role: c.user.role, name: c.user.name } : null;

/** L'architecte signe ses devis ; Mikado Deco signe seulement les siens. */
async function canSignQuote(
  ownerId: number | null,
  c: Awaited<ReturnType<typeof context>>,
) {
  if (!ownerId) return !c.user || c.user.role === "admin";
  const owner = await db.user.findUnique({
    where: { id: ownerId },
    select: { role: true },
  });
  if (owner?.role === "architect") return c.user?.id === ownerId;
  return !c.user || c.user.role === "admin";
}

/**
 * Devis d'un compte externe : prix catalogue verrouillés, et jamais de lien
 * vers une fiche client Shopify (l'architecte saisit les coordonnées lui-même).
 */
function externalState<S extends Parameters<typeof lockPrices>[0] & { customerId: string | null }>(
  s: S,
): S {
  return { ...lockPrices(s), customerId: null };
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
      // Outil pro : la liste des devis est /app/devis (/app est l'accueil).
      return redirect(
        c.embedded ? "/app?status=deleted" : "/app/devis?status=deleted",
      );
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
      // Plus de version client sans remises (Cyril, 26/11/2026).
      const parsed = {
        ...quoteSchema.parse(JSON.parse(raw)),
        hideDiscounts: false,
      };
      const state = isExternal(c) ? externalState(parsed) : parsed;
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
      const parsed = {
        ...quoteSchema.parse(JSON.parse(raw)),
        hideDiscounts: false,
      };
      await saveQuote(
        c.shop,
        id,
        version,
        isExternal(c) ? externalState(parsed) : parsed,
      );
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
    if (intent === "share") {
      const { token } = await createShare(c.shop, id, version, c.user?.id ?? null);
      return {
        ok: "Lien créé. Copiez-le maintenant : il ne sera plus affiché.",
        shareUrl: `${new URL(request.url).origin}/d/${token}`,
      };
    }
    if (intent === "sign") {
      await signDecision(c.shop, id, signer(c), {
        name: form.get("name") ?? "",
        confirm: form.get("confirm") ?? "",
      });
      return { ok: "Contresigné. Mikado Deco a reçu la commande pour facturation." };
    }
    if (intent === "reopen") {
      await reopenDecision(c.shop, id, signer(c));
      return { ok: "Devis rouvert. Le lien est retiré ; préparez une nouvelle version." };
    }
    if (intent === "unshare") {
      await revokeShares(c.shop, id);
      return { ok: "Lien retiré. Le client ne peut plus ouvrir la proposition." };
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
      return redirect("/app/devis");
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
/**
 * Clé de l'éditeur. Chaque enregistrement automatique crée une version ; si la
 * clé suivait la version, l'éditeur se remontait à chaque fois sur l'état
 * enregistré et perdait ce qui avait été tapé pendant l'envoi (lettres perdues
 * dans le nom d'une pièce). La clé ne change donc que si le devis change
 * ailleurs : reprise d'une sauvegarde, photos ajoutées, autre onglet.
 */
function useEditorKey(q: { id: number; version: number; state: string }) {
  const sent = useRef(new Set<string>()),
    seen = useRef({ id: q.id, version: q.version }),
    [epoch, setEpoch] = useState(0);
  for (const f of useFetchers())
    if (f.formData?.get("intent") === "save")
      sent.current.add(String(f.formData.get("state")));
  if (seen.current.id !== q.id || seen.current.version !== q.version) {
    const own = seen.current.id === q.id && sent.current.has(q.state);
    seen.current = { id: q.id, version: q.version };
    if (!own) setEpoch((n) => n + 1);
    sent.current.clear();
  }
  return `${q.id}-${epoch}`;
}
export default function Quote() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const editorKey = useEditorKey(data.q);
  const [catalogue, setCatalogue] = useState(false);
  // Alternative ou option en cours : le catalogue ajoute sous ce produit.
  const [alternative, setAlternative] = useState<CatalogueTarget | null>(null);
  const chooseAlternative = (t: CatalogueTarget | null) => {
    if (t?.refine) {
      // Famille retrouvée après coup : seulement si la même cible est encore ouverte.
      setAlternative((cur) =>
        cur && cur.group === t.group && cur.mode === t.mode ? t : cur,
      );
      return;
    }
    setAlternative(t);
    if (t) {
      setCatalogue(true);
      // Clavier à l'écran : pas de focus automatique sur tablette et téléphone.
      if (matchMedia("(pointer: fine)").matches)
        requestAnimationFrame(() =>
        document
          .querySelector<HTMLInputElement>('.catalogue-pane input[type="search"]')
          ?.focus({ preventScroll: true }),
      );
    } else if (matchMedia("(max-width: 1000px)").matches) setCatalogue(false);
  };
  // Catalogue en volet (iPad vertical, téléphone) : Échap le referme, sauf
  // si une fenêtre ou un menu déroulant est ouvert par-dessus.
  useEffect(() => {
    if (!catalogue) return;
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key !== "Escape" ||
        e.defaultPrevented ||
        !matchMedia("(max-width: 1000px)").matches ||
        document.querySelector("dialog[open], .catalogue-pane details[open]")
      )
        return;
      setCatalogue(false);
      setAlternative(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [catalogue]);
  // Outil pro : le catalogue à gauche du devis, tant que le devis se modifie.
  const editable =
    data.q.status === "draft" &&
    !["creating", "uncertain", "complete"].includes(
      data.q.conversion?.status || "",
    );
  if (data.embedded || !editable)
    return (
      <Editor key={editorKey} {...data} result={result} />
    );
  const editor = (
    <Editor
      key={editorKey}
      {...data}
      result={result}
      catalogueTarget={alternative}
      onCatalogueTarget={chooseAlternative}
    />
  );
  return (
    <div className={`quote-workspace${catalogue ? " catalogue-open" : ""}`}>
      <CatalogueBrowser
        open={catalogue}
        onClose={() => {
          setCatalogue(false);
          setAlternative(null);
        }}
        alternative={alternative}
        onCancelAlternative={() => chooseAlternative(null)}
      />
      <div className="quote-pane">
        {editor}
        <button
          type="button"
          className="catalogue-toggle"
          aria-expanded={catalogue}
          onClick={() => setCatalogue(!catalogue)}
        >
          {catalogue ? "Fermer le catalogue" : "Catalogue"}
        </button>
      </div>
    </div>
  );
}
