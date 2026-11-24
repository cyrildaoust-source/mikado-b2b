import { useState } from "react";
import { Modal } from "./Modal";
import { money, fiscalTotals, quoteSchema } from "../../domain/quote";
import {
  billingKindLabel,
  billingMilestones,
  type BillingKind,
} from "../../domain/billing";
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
  const [confirmAcceptance, setConfirmAcceptance] = useState(false);
  const [confirmedMilestone, setConfirmedMilestone] =
    useState<BillingKind | null>(null);
  const state = quoteSchema.parse(JSON.parse(q.state));
  const totals = fiscalTotals(state);
  const milestones =
    totals.complete && state.taxPolicy === "BE21" ? billingMilestones(state) : [];
  const ready = q.revisions.some(
    (revision) =>
      revision.version === q.version &&
      revision.pdfGeneratedAt &&
      revision.publishedNumber,
  );
  const accepted = q.conversion?.orderStatus === "complete";
  const statusLabels: Record<string, string> = {
    queued: "Demande enregistrée",
    checking: "Contrôle des données Odoo",
    creating: "Création du brouillon",
    uncertain: "À vérifier dans Odoo",
    error: "Action nécessaire",
    linked: "Brouillon Odoo lié",
  };
  const paymentLabels: Record<string, string> = {
    not_paid: "À payer",
    partial: "Règlement partiel",
    in_payment: "Paiement en cours",
    paid: "Soldée dans Odoo",
    reversed: "Extournée",
    blocked: "Bloquée",
  };
  const previousReady = (index: number) =>
    milestones.slice(0, index).every((milestone) => {
      const request = q.billingRequests.find(
        (candidate) => candidate.kind === milestone.kind,
      );
      return (
        request?.status === "linked" &&
        request.invoiceState === "posted" &&
        !request.error
      );
    });

  return (
    <s-section heading="Facturation Odoo">
      {mode === "simulation" && (
        <p className="notice">Simulation locale · aucune facture réelle</p>
      )}
      {mode === "live" ? (
        <p className="notice">
          Connecté à Odoo · contact rapproché ou créé automatiquement · brouillons uniquement
        </p>
      ) : mode === "disabled" ? (
        <p className="notice">
          Le circuit est prêt pour les tests. La création réelle reste désactivée.
        </p>
      ) : null}

      <p>
        {accepted
          ? `Commande Shopify ${q.conversion?.orderName} confirmée.`
          : "Après l’accord du client, la commande Shopify sera confirmée avec paiement en attente."}
      </p>

      <div className="billing-timeline">
        {milestones.map((milestone, index) => {
          const request = q.billingRequests.find(
            (candidate) => candidate.kind === milestone.kind,
          );
          const available = accepted && previousReady(index);
          return (
            <div className="billing-request" key={milestone.kind}>
              <strong>
                {milestone.label} · {money(milestone.amount)} TVAC
              </strong>
              <p className="muted">
                {money(milestone.net)} HTVA · TVA {money(milestone.tax)}
              </p>
              {request ? (
                <>
                  <p>
                    {statusLabels[request.status] || request.status}
                    {request.invoiceNumber ? ` · ${request.invoiceNumber}` : ""}
                  </p>
                  {request.invoiceId && odooUrl && mode === "live" && (
                    <a
                      href={`${odooUrl}/web#id=${request.invoiceId}&model=account.move&view_type=form`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Ouvrir le brouillon dans Odoo
                    </a>
                  )}
                  {request.invoiceState && (
                    <p>
                      {request.invoiceState === "draft"
                        ? "Brouillon à contrôler et valider dans Odoo"
                        : request.invoiceState === "cancel"
                          ? "Facture annulée"
                          : paymentLabels[request.paymentState || ""] ||
                            "État à vérifier"}
                    </p>
                  )}
                  {request.residual !== null &&
                    request.invoiceState === "posted" && (
                      <p>
                        Reste à régler : <strong>{money(request.residual)}</strong>
                      </p>
                    )}
                  {request.error && (
                    <p role="alert" className="error">
                      {request.error}
                    </p>
                  )}
                  {request.status === "error" && (
                    <button
                      disabled={busy || mode === "disabled"}
                      onClick={() =>
                        onAction("billing-retry", { requestId: request.id })
                      }
                    >
                      Réessayer après correction
                    </button>
                  )}
                  {request.syncedAt && (
                    <small>
                      Actualisé le{" "}
                      {new Date(request.syncedAt).toLocaleString("fr-BE")}
                    </small>
                  )}
                </>
              ) : available ? (
                <button
                  disabled={busy || dirty || mode === "disabled"}
                  onClick={() =>
                    milestone.requiresDeliveryConfirmation
                      ? setConfirmedMilestone(milestone.kind)
                      : onAction("billing-request", { kind: milestone.kind })
                  }
                >
                  Préparer le brouillon {billingKindLabel(milestone.kind).toLowerCase()}
                </button>
              ) : accepted ? (
                <p className="muted">
                  Disponible après validation de l’échéance précédente dans Odoo.
                </p>
              ) : (
                <p className="muted">Disponible après acceptation du devis.</p>
              )}
            </div>
          );
        })}
      </div>

      {!accepted && (
        <button
          className="primary"
          disabled={
            busy ||
            dirty ||
            !ready ||
            !milestones.length ||
            q.status === "archived" ||
            mode === "disabled" ||
            (mode === "live" && !q.conversion?.draftId)
          }
          onClick={() => setConfirmAcceptance(true)}
        >
          {q.conversion?.orderStatus
            ? "Vérifier la commande"
            : "Confirmer l’accord du client"}
        </button>
      )}

      {q.conversion?.orderId && mode === "live" && (
        <p>
          <a
            href={`https://${q.shop}/admin/orders/${q.conversion.orderId.split("/").at(-1)}`}
            target="_blank"
            rel="noreferrer"
          >
            Ouvrir la commande Shopify
          </a>
        </p>
      )}

      {mode === "simulation" && q.billingRequests.length > 0 && (
        <details>
          <summary>Tester le circuit complet</summary>
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
        L’application crée uniquement des brouillons. La validation comptable et
        l’enregistrement des paiements restent dans Odoo.
      </p>

      {confirmAcceptance && (
        <Modal
          title="Confirmer l’accord du client"
          onClose={() => setConfirmAcceptance(false)}
        >
          <p>
            Vous confirmez que le client a accepté la version PDF actuelle, pour{" "}
            <strong>{money(totals.gross)} TVAC</strong>.
          </p>
          <p>
            La commande Shopify sera finalisée avec paiement en attente. Le
            brouillon Odoo de {milestones[0]?.label.toLowerCase()} sera ensuite
            préparé pour contrôle.
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={() => {
              setConfirmAcceptance(false);
              onAction("accept-order");
            }}
          >
            Confirmer et préparer le premier brouillon
          </button>
        </Modal>
      )}

      {confirmedMilestone && (
        <Modal
          title="Confirmer la livraison"
          onClose={() => setConfirmedMilestone(null)}
        >
          <p>
            Confirmez que la livraison a bien eu lieu avant de préparer le
            dernier brouillon Odoo.
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={() => {
              const kind = confirmedMilestone;
              setConfirmedMilestone(null);
              onAction("billing-request", {
                kind,
                milestoneConfirmed: "true",
              });
            }}
          >
            Livraison effectuée · préparer le solde
          </button>
        </Modal>
      )}
    </s-section>
  );
}
