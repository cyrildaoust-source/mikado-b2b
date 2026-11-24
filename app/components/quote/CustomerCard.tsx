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
          ["company", "Entreprise"],
          ["address1", "Adresse"],
          ["address2", "Complément"],
          ["zip", "Code postal"],
          ["city", "Ville"],
        ] as const
      ).map(([k, label]) => (
        <label key={k}>
          {label}
          <input
            value={value[k]}
            onChange={(e) => onChange({ ...value, [k]: e.target.value })}
          />
        </label>
      ))}
      <label>
        Pays
        <select
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
            <h3>Livraison</h3>
            <p>
              {[
                s.shipping.address1,
                s.shipping.address2,
                [s.shipping.zip, s.shipping.city].filter(Boolean).join(" "),
              ]
                .filter(Boolean)
                .join(", ") || "Adresse à compléter"}
            </p>
            <span className="muted">
              {s.billingSame
                ? "Facturation à la même adresse"
                : "Adresse de facturation distincte"}
            </span>
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
