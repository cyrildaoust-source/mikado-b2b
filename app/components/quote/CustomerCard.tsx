import { type QuoteState } from "../../domain/quote";
const countries = [
  ["BE", "Belgique"],
  ["FR", "France"],
  ["LU", "Luxembourg"],
  ["NL", "Pays-Bas"],
  ["DE", "Allemagne"],
];
export function AddressFields({
  value,
  onChange,
}: {
  value: QuoteState["shipping"];
  onChange: (v: QuoteState["shipping"]) => void;
}) {
  return (
    <div className="fields">
      {(
        [
          ["company", "Entreprise", "organization"],
          ["address1", "Adresse", "address-line1"],
          ["address2", "Complément", "address-line2"],
          ["zip", "Code postal", "postal-code"],
          ["city", "Ville", "address-level2"],
        ] as const
      ).map(([k, label, auto]) => (
        <label key={k}>
          {label}
          <input
            autoComplete={auto}
            maxLength={k === "zip" ? 20 : 150}
            value={value[k]}
            onChange={(e) => onChange({ ...value, [k]: e.target.value })}
          />
        </label>
      ))}
      <label>
        Pays
        <select
          autoComplete="country"
          value={value.countryCode}
          onChange={(e) => onChange({ ...value, countryCode: e.target.value })}
        >
          {!countries.some(([c]) => c === value.countryCode) && (
            <option value={value.countryCode}>{value.countryCode}</option>
          )}
          {countries.map(([c, n]) => (
            <option key={c} value={c}>
              {n}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
const line = (a: QuoteState["shipping"]) =>
  [a.address1, a.address2, [a.zip, a.city].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ") || "Adresse à compléter";

export function CustomerCard({
  state: s,
  onEdit,
  onSearch,
  disabled = false,
}: {
  state: QuoteState;
  disabled?: boolean;
  onEdit: () => void;
  onSearch: () => void;
}) {
  return (
    <>
      <div className="card-title">
        <h2>Client</h2>
        <button
          className="text-button"
          type="button"
          disabled={disabled}
          onClick={s.client ? onEdit : onSearch}
        >
          {s.client ? "Modifier" : "Choisir un client"}
        </button>
      </div>
      {s.client ? (
        <>
          <strong>{s.client}</strong>
          {s.contact && s.contact !== s.client && <p>{s.contact}</p>}
          {s.email && <p className="muted">{s.email}</p>}
          {s.customerVat && <p className="muted">N° TVA : {s.customerVat}</p>}
          <div className="address-summary">
            <h3>Facturation</h3>
            <p>{line(s.billingSame ? s.shipping : s.billing)}</p>
            <h3>Livraison</h3>
            <p>
              {s.billingSame ? "À l’adresse de facturation" : line(s.shipping)}
            </p>
          </div>
        </>
      ) : (
        <>
          <p className="muted">Choisissez un client Shopify ou saisissez ses coordonnées directement pour ce devis.</p>
          <button type="button" disabled={disabled} onClick={onEdit}>
            Ajouter un nouveau client
          </button>
        </>
      )}
    </>
  );
}
