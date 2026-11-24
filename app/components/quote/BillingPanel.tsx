import { useState } from "react";
import { Modal } from "./Modal";
import { money, fiscalTotals, quoteSchema } from "../../domain/quote";
import type { getQuote } from "../../services/quotes.server";
type Q = Awaited<ReturnType<typeof getQuote>>;
export function BillingPanel({
  q,
  mode,
  odooUrl,
  busy,
  dirty,
  onAction,
}: {
  q: Q;
  mode: "disabled" | "simulation" | "live";
  odooUrl: string | null;
  busy: boolean;
  dirty: boolean;
  onAction: (intent: string, extra?: Record<string, string>) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const state = quoteSchema.parse(JSON.parse(q.state));
  const totals = fiscalTotals(state);
  const stagedPayment = state.payment === "installments";
  const ready = q.revisions.some(
    (r) => r.version === q.version && r.pdfGeneratedAt && r.publishedNumber,
  );
  const accepted = q.conversion?.orderStatus === "complete";
  const labels: Record<string, string> = {
    queued: "Demande en attente",
    checking: "Vérification Odoo",
    creating: "Création en cours",
    uncertain: "Création à vérifier",
    error: "Action nécessaire",
    linked: "Facture liée",
  };
  const paymentLabels: Record<string, string> = {
    not_paid: "À payer",
    partial: "Règlement partiel",
    in_payment: "Paiement en cours",
    paid: "Soldée dans Odoo",
    reversed: "Extournée",
    blocked: "Bloquée",
  };
  return (
    <s-section heading="Facturation Odoo">
      {mode === "simulation" && (
        <p className="notice">Simulation locale · aucune facture réelle</p>
      )}
      {mode === "disabled" && (
        <p>
          Connexion à configurer. La facturation automatique est désactivée.
        </p>
      )}
      <p>
        {accepted
          ? `Commande ${q.conversion?.orderName} confirmée`
          : "Après l’accord du client, confirmez la commande et préparez son acompte dans Odoo."}
      </p>
      <p>
        Acompte prévu :{" "}
        <strong>
          {totals.deposit === null ? "À définir" : money(totals.deposit)} TVAC
        </strong>
      </p>
      {!accepted && (
        <button
          disabled={
            busy ||
            dirty ||
            !ready ||
            q.status === "archived" ||
            mode === "disabled" ||
            (mode === "live" && !q.conversion?.draftId)
          }
          onClick={() => setConfirm(true)}
        >
          {q.conversion?.orderStatus
            ? "Vérifier la commande"
            : "Confirmer l’accord du client"}
        </button>
      )}
      {q.conversion?.orderId && mode === "live" && (
        <a
          href={`https://${q.shop}/admin/orders/${q.conversion.orderId.split("/").at(-1)}`}
          target="_blank"
          rel="noreferrer"
        >
          Ouvrir la commande Shopify
        </a>
      )}
      {q.billingRequests.map((r) => (
        <div className="billing-request" key={r.id}>
          <strong>
            {r.kind === "deposit" ? "Acompte" : "Solde"} · {money(r.amount)}{" "}
            TVAC
          </strong>
          <p>
            {labels[r.status] || r.status}
            {r.invoiceNumber ? ` · ${r.invoiceNumber}` : ""}
          </p>
          {r.invoiceId && odooUrl && mode === "live" && (
            <a
              href={`${odooUrl}/web#id=${r.invoiceId}&model=account.move&view_type=form`}
              target="_blank"
              rel="noreferrer"
            >
              Ouvrir la facture dans Odoo
            </a>
          )}
          {r.invoiceState && (
            <p>
              {r.invoiceState === "draft"
                ? "Brouillon à valider dans Odoo"
                : r.invoiceState === "cancel"
                  ? "Facture annulée"
                  : paymentLabels[r.paymentState || ""] || "État à vérifier"}
            </p>
          )}
          {r.residual !== null && r.invoiceState === "posted" && (
            <p>
              Reste à régler sur cette facture :{" "}
              <strong>{money(r.residual)}</strong>
            </p>
          )}
          {r.error && (
            <p role="alert" className="error">
              {r.error}
            </p>
          )}
          {r.status === "error" && (
            <button
              disabled={busy || mode === "disabled"}
              onClick={() => onAction("billing-retry", { requestId: r.id })}
            >
              Réessayer après correction
            </button>
          )}
          {r.syncedAt && (
            <small>
              Dernière synchronisation :{" "}
              {new Date(r.syncedAt).toLocaleString("fr-BE")}
            </small>
          )}
        </div>
      ))}
      {accepted &&
        !q.billingRequests.some(
          (r) => r.kind === "deposit" || r.kind === "balance",
        ) &&
        !!totals.deposit && (
          <button
            disabled={busy || mode === "disabled"}
            onClick={() => onAction("billing-deposit")}
          >
            Demander le brouillon d’acompte
          </button>
        )}
      {accepted &&
        !stagedPayment &&
        !q.billingRequests.some((r) => r.kind === "balance") &&
        totals.gross > q.billingRequests.reduce((n, r) => n + r.amount, 0) && (
          <button
            disabled={
              busy ||
              mode === "disabled" ||
              (!!totals.deposit &&
                !q.billingRequests.some((r) => r.kind === "deposit")) ||
              q.billingRequests.some(
                (r) =>
                  r.invoiceState !== "posted" ||
                  r.status !== "linked" ||
                  !!r.error,
              )
            }
            onClick={() => onAction("billing-balance")}
          >
            Demander le brouillon du solde
          </button>
        )}
      {accepted && stagedPayment && (
        <p className="notice">
          Les échéances de 50 % avant livraison et 20 % après livraison seront
          créées séparément lorsque ce circuit sera connecté à Odoo.
        </p>
      )}
      {mode === "simulation" && q.billingRequests.length > 0 && (
        <details>
          <summary>Tester le circuit Odoo</summary>
          <div className="button-row">
            <button
              disabled={busy}
              onClick={() => onAction("billing-simulate", { stage: "draft" })}
            >
              1. Créer les brouillons fictifs
            </button>
            <button
              disabled={busy}
              onClick={() => onAction("billing-simulate", { stage: "posted" })}
            >
              2. Simuler la validation
            </button>
            <button
              disabled={busy}
              onClick={() => onAction("billing-simulate", { stage: "paid" })}
            >
              3. Simuler le règlement
            </button>
          </div>
        </details>
      )}
      <p className="muted">
        La création d’une facture ne vaut pas paiement. Les états Odoo peuvent
        également refléter des avoirs. Aucun encaissement Shopify n’est
        effectué.
      </p>
      {confirm && (
        <Modal
          title={
            mode === "simulation"
              ? "Tester l’acceptation du devis"
              : "Confirmer l’accord du client"
          }
          onClose={() => setConfirm(false)}
        >
          <p>
            Vous confirmez que le client a accepté la version PDF actuelle, pour{" "}
            {money(totals.gross)} TVAC.
          </p>
          <p>
            {mode === "simulation"
              ? "Une commande fictive sera créée pour tester le circuit."
              : "La commande sera finalisée dans Shopify avec paiement en attente. Cette action réserve le stock Shopify."}
          </p>
          {!!totals.deposit && (
            <p>
              Un brouillon de facture d’acompte de {money(totals.deposit)} sera
              demandé à Odoo. Vous le validerez dans Odoo.
            </p>
          )}
          <button
            className="primary"
            disabled={busy}
            onClick={() => {
              setConfirm(false);
              onAction("accept-order");
            }}
          >
            Confirmer et préparer l’acompte
          </button>
        </Modal>
      )}
    </s-section>
  );
}
