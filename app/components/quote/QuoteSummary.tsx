import {
  fiscalTotals,
  costBreakdown,
  money,
  type QuoteState,
} from "../../domain/quote";
import { billingMilestones } from "../../domain/billing";
import { publicMerchandise } from "../../domain/pro";
import { ProPrice } from "../ProPrice";
export function QuoteSummary({ state: s }: { state: QuoteState }) {
  const f = fiscalTotals(s),
    breakdown = costBreakdown(s),
    schedule = f.complete ? billingMilestones(s) : [];
  return (
    <div className="quote-summary">
      <div className="total-hero">
        <span>Total HTVA</span>
        <strong>{money(breakdown.total)}</strong>
      </div>
      <div className="sumrow">
        <span>Produits retenus</span>
        <span>{money(breakdown.products)}</span>
      </div>
      {breakdown.options !== 0 && (
        <div className="sumrow">
          <span>Options incluses</span>
          <span>{money(breakdown.options)}</span>
        </div>
      )}
      {breakdown.delivery !== 0 && (
        <div className="sumrow">
          <span>{breakdown.deliveryName}</span>
          <span>{money(breakdown.delivery)}</span>
        </div>
      )}
      {f.taxLines.map((l) => (
        <div className="sumrow" key={l.rate}>
          <span>TVA {l.rate} %</span>
          <span>{money(l.amount)}</span>
        </div>
      ))}
      <div className="sumrow total-gross">
        <strong>Total TVAC</strong>
        <strong>{f.complete ? money(f.gross) : "À vérifier"}</strong>
      </div>
      {/* Vue privée de l'architecte : jamais reprise dans le PDF. */}
      <ProPrice
        always
        cents={publicMerchandise(s)}
        label="Marchandise au prix pro, HTVA :"
        className="summary-pro"
      />
      {schedule.length > 0 && (
        <div className="payment-summary">
          {schedule.map((stage, index) => (
            <div className="sumrow" key={stage.label}>
              <span>{stage.label}</span>
              {index === 0 ? (
                <strong>{money(stage.amount)}</strong>
              ) : (
                <span>{money(stage.amount)}</span>
              )}
            </div>
          ))}
          <small>Montants de paiement TVAC</small>
        </div>
      )}
    </div>
  );
}
