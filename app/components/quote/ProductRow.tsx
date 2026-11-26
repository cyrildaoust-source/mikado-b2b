import { NumberField } from "./NumberField";
import { lineTotal, money, signedMoney, type Line } from "../../domain/quote";
import { safeImage } from "../QuoteDocument";
import { ProPrice } from "../ProPrice";
import { isCataloguePrice, publicUnitPrice } from "../../domain/pro";
export function ProductRow({
  line: i,
  base,
  selected,
  onSelect,
  onChange,
  onRemove,
  option,
  priceLocked = false,
}: {
  /** Compte architecte : prix du catalogue, sans remise ni saisie libre. */
  priceLocked?: boolean;
  /** Option rattachée à un produit : case « inclure », hors total sinon. */
  option?: { of: string; onToggle: (included: boolean) => void };
  line: Line;
  base?: Line;
  selected: boolean;
  onSelect?: () => void;
  onChange: (patch: Partial<Line>) => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={`product-row ${base ? "alternative-row" : ""}${
        option
          ? ` option-row${selected ? "" : " not-included"}`
          : selected
            ? " selected-row"
            : ""
      }`}
    >
      <div className="product-heading">
        {option && (
          <input
            type="checkbox"
            aria-label={`Inclure l’option ${i.name} dans le total`}
            checked={selected}
            onChange={(e) => option.onToggle(e.target.checked)}
          />
        )}
        {onSelect && (
          <input
            type="radio"
            aria-label={`Retenir ${i.name}`}
            checked={selected}
            onChange={onSelect}
          />
        )}
        {safeImage(i.image) ? (
          <img className="product-thumb" src={safeImage(i.image)} alt="" />
        ) : (
          <span className="product-placeholder" aria-hidden="true">
            ◇
          </span>
        )}
        <div className="product-name">
          <strong>{i.name}</strong>
          <span className="muted">
            {i.sku || (i.variantId ? "Produit Shopify" : "Ligne personnalisée")}
          </span>
          {base && (
            <span className="alternative-caption">
              {i.qty === base.qty
                ? `${signedMoney(lineTotal(i) - lineTotal(base))} HTVA pour ${i.qty} unité${i.qty > 1 ? "s" : ""}`
                : `${i.qty} unité${i.qty > 1 ? "s" : ""} · ${money(lineTotal(i))} HTVA`}
            </span>
          )}
          {option && (
            <small className={selected ? "selection-label" : "muted"}>
              {selected ? "Option incluse dans le total" : "Option, hors total"}
            </small>
          )}
          {onSelect && (
            <small className={selected ? "selection-label" : "muted"}>
              {selected ? "Retenu dans le devis" : "Alternative non retenue"}
            </small>
          )}
        </div>
      </div>
      <label>
        <span className="field-label">Quantité</span>
        <NumberField
          aria-label={`Quantité ${i.name}`}
          type="number"
          min={1}
          max={10000}
          value={i.qty}
          onChange={(e) => onChange({ qty: Number(e.target.value) })}
        />
      </label>
      {priceLocked && isCataloguePrice(i) ? (
        <>
          <div className="line-fixed-price">
            <span className="field-label">Prix HTVA</span>
            <span>{money(i.price)}</span>
          </div>
          <label>
            <span className="field-label">Remise client %</span>
            <NumberField
              aria-label={`Remise ${i.name}`}
              type="number"
              min={0}
              max={100}
              step={1}
              value={i.discount}
              onChange={(e) => onChange({ discount: Number(e.target.value) })}
            />
          </label>
        </>
      ) : priceLocked ? (
        <>
          <label>
            <span className="field-label">Prix HTVA</span>
            <NumberField
              aria-label={`Prix ${i.name}`}
              type="number"
              min={0}
              max={1000000}
              step=".01"
              value={i.price / 100}
              onChange={(e) =>
                onChange({
                  price: Math.round(Number(e.target.value) * 100),
                  priceConfirmed: true,
                })
              }
            />
          </label>
          <label>
            <span className="field-label">Remise client %</span>
            <NumberField
              aria-label={`Remise ${i.name}`}
              type="number"
              min={0}
              max={100}
              step={1}
              value={i.discount}
              onChange={(e) => onChange({ discount: Number(e.target.value) })}
            />
          </label>
        </>
      ) : (
        <>
          <label>
            <span className="field-label">Prix HTVA</span>
            <NumberField
              aria-label={`Prix ${i.name}`}
              type="number"
              min={0}
              max={1000000}
              step=".01"
              value={i.price / 100}
              onChange={(e) =>
                onChange({
                  price: Math.round(Number(e.target.value) * 100),
                  priceConfirmed: true,
                })
              }
            />
          </label>
          <label>
            <span className="field-label">Remise %</span>
            <NumberField
              aria-label={`Remise ${i.name}`}
              type="number"
              min={0}
              max={100}
              step={1}
              value={i.discount}
              onChange={(e) => onChange({ discount: Number(e.target.value) })}
            />
          </label>
        </>
      )}
      <div className="line-amount">
        <span>Total HTVA</span>
        <strong>{money(lineTotal(i))}</strong>
        {i.sourcePrice !== null && (
          <ProPrice always cents={publicUnitPrice(i) * i.qty} />
        )}
      </div>
      <button
        className="icon-button"
        aria-label={`Retirer ${i.name}`}
        title="Retirer"
        onClick={onRemove}
        type="button"
      >
        ×
      </button>
      <div className="product-details">
        <details>
          <summary>Détails du produit</summary>
          {i.variantId ? (
            <p className="preline">
              {i.detail || "Aucune description dans la fiche Shopify."}
            </p>
          ) : (
            <label>
              Description
              <textarea
                aria-label={`Description ${i.name}`}
                value={i.detail}
                maxLength={4000}
                onChange={(e) => onChange({ detail: e.target.value })}
              />
            </label>
          )}
        </details>
      </div>
    </div>
  );
}
