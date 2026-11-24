import {
  type QuoteState,
  paymentText,
  setDeliveryFee,
  money,
  lineTotal,
} from "../../domain/quote";
export function PaymentTerms({
  state: s,
  onChange,
}: {
  state: QuoteState;
  onChange: (s: QuoteState) => void;
}) {
  const value =
    s.payment === "deposit" && [30, 50].includes(s.depositPercent || 0)
      ? `deposit${s.depositPercent}`
      : s.payment;
  function choose(value: string) {
    const payment = value.startsWith("deposit")
      ? "deposit"
      : (value as QuoteState["payment"]);
    const depositPercent =
      value === "deposit30"
        ? 30
        : value === "deposit50"
          ? 50
          : payment === "full"
            ? 100
            : payment === "installments"
              ? 30
              : null;
    onChange({
      ...s,
      payment,
      depositPercent,
      terms: paymentText(
        payment,
        depositPercent,
        payment === "custom" ? "" : s.terms,
      ),
    });
  }
  return (
    <div className="fields">
      <label>
        Modalités de paiement
        <select value={value} onChange={(e) => choose(e.target.value)}>
          <option value="unspecified">À convenir</option>
          <option value="cash">Paiement comptant</option>
          <option value="deposit30">
            Acompte de 30 %, solde avant livraison
          </option>
          <option value="deposit50">
            Acompte de 50 %, solde avant livraison
          </option>
          <option value="installments">
            30 % à la commande, 50 % avant livraison, 20 % après livraison
          </option>
          <option value="full">Paiement intégral à la commande</option>
          <option value="custom">Conditions personnalisées</option>
          {s.payment === "legacy" && (
            <option value="legacy">Conditions existantes</option>
          )}
          {value === "deposit" && (
            <option value="deposit">Acompte personnalisé</option>
          )}
        </select>
      </label>
      {s.payment === "deposit" && (
        <label>
          Acompte (%)
          <input
            type="number"
            min="0"
            max="100"
            step=".01"
            value={s.depositPercent ?? ""}
            onChange={(e) => {
              const depositPercent =
                e.target.value === "" ? null : Number(e.target.value);
              onChange({
                ...s,
                depositPercent,
                terms: paymentText("deposit", depositPercent),
              });
            }}
          />
        </label>
      )}
      {["custom", "legacy"].includes(s.payment) && (
        <>
          <label className="full-width">
            Conditions du devis
            <textarea
              value={s.terms}
              maxLength={4000}
              onChange={(e) =>
                onChange({
                  ...s,
                  terms: e.target.value,
                  payment: "custom",
                  depositPercent: null,
                })
              }
            />
          </label>
          <p className="muted full-width">
            Pour afficher un acompte chiffré, choisissez une modalité d’acompte.
            Les conditions libres n’ajoutent pas d’échéance automatique.
          </p>
        </>
      )}
      <div className="full-width">
        <label className="check">
          <input
            type="checkbox"
            checked={s.extras.some((e) => e.deliveryFee && e.selected)}
            onChange={(e) =>
              onChange(setDeliveryFee(s, e.target.checked, crypto.randomUUID()))
            }
          />
          Ajouter la livraison + montage — 3 %
        </label>
        <p className="muted">
          Calculée sur les produits retenus après remise, hors TVA. Le montant
          s’ajoute au devis et se recalcule lorsque les produits changent.
        </p>
        {s.extras
          .filter((e) => e.deliveryFee && e.selected)
          .map((e) => (
            <strong key={e.id}>
              Livraison + montage : {money(lineTotal(e))} HTVA
            </strong>
          ))}
      </div>
      <label>
        Livraison estimée
        <input
          value={s.delivery}
          maxLength={4000}
          onChange={(e) => onChange({ ...s, delivery: e.target.value })}
        />
      </label>
      <label>
        Valable jusqu’au
        <input
          type="date"
          value={s.validity}
          onChange={(e) => onChange({ ...s, validity: e.target.value })}
        />
      </label>
    </div>
  );
}
