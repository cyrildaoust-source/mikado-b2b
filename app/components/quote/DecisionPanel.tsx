import { useFetcher } from "react-router";
import { money } from "../../domain/quote";
import type { CurrentDecision } from "../../services/decision.server";

const when = (iso: string) =>
  new Date(iso).toLocaleString("fr-BE", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Brussels",
  });

/**
 * Réponse du client sur la proposition en ligne. L'architecte contresigne
 * (nom, date et heure) dans les 48 h, ou rouvre le devis pour le réviser.
 */
export function DecisionPanel({
  decision: d,
  signerName,
  canSign,
}: {
  decision: CurrentDecision;
  signerName: string;
  canSign: boolean;
}) {
  const f = useFetcher<{ ok?: string; error?: string }>();
  const busy = f.state !== "idle";
  return (
    <section
      className={`decision-panel${d.late ? " is-late" : ""}`}
      aria-label="Réponse du client"
    >
      <div className="decision-head">
        <strong>
          Accepté par {d.clientName} · {money(d.gross)} TVAC
        </strong>
        <span className="muted">Le {when(d.acceptedAt)}</span>
      </div>
      {d.remark && (
        <blockquote className="decision-remark">{d.remark}</blockquote>
      )}
      {d.status === "accepted" && (
        <>
          <p className={d.late ? "notice" : "muted"}>
            {d.late
              ? `Le délai de 48 h est dépassé depuis le ${when(d.deadline)}. Rien n'est facturé tant que vous n'avez pas contresigné.`
              : `À contresigner avant le ${when(d.deadline)}. Si une révision est nécessaire, rouvrez le devis : le client recevra une nouvelle proposition.`}
          </p>
          {canSign ? (
            <f.Form method="post" className="decision-sign">
              <label>
                Votre nom
                <input name="name" defaultValue={signerName} required maxLength={120} />
              </label>
              <label className="decision-confirm">
                <input type="checkbox" name="confirm" required />
                <span>
                  Je confirme la commande telle qu'acceptée par mon client et
                  la transmets à Mikado Deco pour facturation.
                </span>
              </label>
              <div className="decision-actions">
                <button className="primary" name="intent" value="sign" disabled={busy}>
                  Contresigner
                </button>
                <button
                  className="text-button"
                  name="intent"
                  value="reopen"
                  formNoValidate
                  disabled={busy}
                >
                  Rouvrir pour réviser
                </button>
              </div>
            </f.Form>
          ) : (
            <p className="muted">En attente de la contresignature de l'architecte.</p>
          )}
        </>
      )}
      {d.status === "signed" && (
        <p className="success">
          Contresigné par {d.architectName} le {when(d.architectSignedAt!)}.
          Transmis à Mikado Deco pour facturation.
        </p>
      )}
      {d.status === "invoiced" && (
        <p className="success">
          Facturé par Mikado Deco le {when(d.invoicedAt!)}
          {d.dueDate &&
            `, échéance le ${new Date(d.dueDate).toLocaleDateString("fr-BE", { timeZone: "Europe/Brussels" })}`}
          .
        </p>
      )}
      {f.data?.error && (
        <p role="alert" className="error">
          {f.data.error}
        </p>
      )}
    </section>
  );
}
