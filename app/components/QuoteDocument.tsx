import { Fragment } from "react";
import {
  quoteSections,
  clientView,
  lineTotal,
  money,
  costBreakdown,
  fiscalTotals,
  signedMoney,
  type QuoteState,
  type Line,
} from "../domain/quote";
import { billingMilestones } from "../domain/billing";
import { LegacyQuoteDocument } from "./LegacyQuoteDocument";
import type { Calculation } from "../services/shopify-api.server";
export { safeImage } from "./LegacyQuoteDocument";
import { safeImage } from "./LegacyQuoteDocument";
import { SALES_TERMS_NOTICE, SALES_TERMS_URL } from "../domain/legal";
export function QuoteDocument({
  state: raw,
  number,
  version,
  demo = false,
  issuedAt,
  seller,
}: {
  seller?: {
    name: string;
    address: string;
    email: string;
    website: string;
    vat: string;
  };
  state: QuoteState;
  number: string;
  version: number;
  demo?: boolean;
  issuedAt?: string | Date | null;
  calculation?: Calculation | null;
}) {
  const s = raw.schemaVersion === 1 ? raw : clientView(raw),
    showDiscount = !s.hideDiscounts,
    cols = showDiscount ? 6 : 5;
  if (s.schemaVersion === 1)
    return (
      <LegacyQuoteDocument
        state={s}
        number={number}
        version={version}
        demo={demo}
      />
    );
  const f = fiscalTotals(s),
    // Keep the PDF aligned with the editor and the Odoo milestone plan. Shopify
    // can redistribute a few cents between net and tax when a tax-inclusive
    // variant price is rounded per unit, even though the TVAC total is equal.
    gross = f.gross,
    tax = f.tax,
    net = f.net,
    breakdown = costBreakdown(s),
    roundingAdjustment = net - breakdown.total,
    taxLines = f.taxLines,
    schedule = f.complete ? billingMilestones(s) : [];
  const addr = (a: QuoteState["shipping"]) =>
    [
      a.company,
      [a.firstName, a.lastName].filter(Boolean).join(" "),
      a.address1,
      a.address2,
      [a.zip, a.city].filter(Boolean).join(" "),
      a.countryCode,
    ]
      .filter(Boolean)
      .join("\n");
  const sections = quoteSections(s),
    // Les options rattachées se lisent sous leur produit ; le reste est une prestation.
    prestations = s.extras.filter(
      (e) => !s.groups.some((g) => g.id === e.parent),
    );
  const row = (i: Line, rep: string, selected: boolean, caption: string) => (
    <tr key={i.id} className={selected ? "retained" : "excluded"}>
      <td>{rep}</td>
      <td>
        <div className="doc-product">
          {safeImage(i.image) && <img src={safeImage(i.image)} alt="" />}
          <div>
            <strong>{i.name}</strong>
            <small>{i.sku}</small>
            {!i.variantId && i.detail && (
              <p className="preline line-detail">{i.detail}</p>
            )}
            <small className="choice-label">
              {selected
                ? "Retenu — inclus dans le total"
                : "Non compris dans le total"}
            </small>
            <small>{caption}</small>
          </div>
        </div>
      </td>
      <td>{i.qty}</td>
      <td>{i.priceConfirmed ? money(i.price) : "À vérifier"}</td>
      {showDiscount && <td>{i.discount ? `${i.discount} %` : "—"}</td>}
      <td>
        {selected && i.priceConfirmed ? (
          money(lineTotal(i))
        ) : selected ? (
          "À vérifier"
        ) : (
          <>
            <span className="excluded-price">
              {i.priceConfirmed ? money(lineTotal(i)) : "À vérifier"}
            </span>
            <small>indicatif / exclu</small>
          </>
        )}
      </td>
    </tr>
  );
  return (
    <article className="paper b2b-paper">
      <div className="paperheader">
        <div>
          <h1>{seller?.name || "Mikado Deco"}</h1>
          <p>Offre d’aménagement professionnel</p>
        </div>
        <div>
          <strong>{number}</strong>
          <br />
          {issuedAt ? `Révision ${version}` : "BROUILLON"}
          <br />
          {issuedAt &&
            `Émis le ${new Date(issuedAt).toLocaleDateString("fr-BE")}`}
        </div>
      </div>
      <div className="doc-addresses">
        <div>
          <h3>CLIENT</h3>
          {s.client || s.contact || s.email ? (
            <>
              {s.client}
              <br />
              {s.contact}
              <br />
              {s.email}
            </>
          ) : (
            "À compléter"
          )}
        </div>
        <div>
          <h3>FACTURATION</h3>
          <div className="preline">
            {(s.billingSame ? s.shipping : s.billing).address1.trim()
              ? addr(s.billingSame ? s.shipping : s.billing)
              : "Adresse à confirmer"}
          </div>
          {s.customerVat && <p>N° TVA client : {s.customerVat}</p>}
        </div>
        <div>
          <h3>LIVRAISON</h3>
          <div className="preline">
            {s.shipping.address1.trim()
              ? addr(s.shipping)
              : "Adresse à confirmer"}
          </div>
        </div>
      </div>
      <div className="doc-project">
        <strong>{s.project}</strong>
        <span>
          Valable jusqu’au {s.validity.split("-").reverse().join("/")}
        </span>
      </div>
      <p className="doc-tax-note">
        {showDiscount ? "Devis B2B : tous" : "Tous"} les prix sont exprimés hors TVA, sauf le total TVAC et
        les échéances de paiement. Seuls les produits et options retenus entrent
        dans le total.
      </p>
      {sections.length > 1 && (
        <nav className="doc-lot-summary" aria-label="Sommaire des pièces">
          <strong>Sommaire des pièces</strong>
          {sections.map((section, index) => (
            <a key={section.id} href={`#doc-lot-${index + 1}`}>
              <span>
                {index + 1}. {section.title}
              </span>
              <span>
                {money(
                  section.groups.reduce(
                    (sum, group) =>
                      sum +
                      lineTotal(
                        group.items.find((item) => item.id === group.selected)!,
                      ),
                    0,
                  ),
                )}
              </span>
            </a>
          ))}
        </nav>
      )}
      <table>
        <thead>
          <tr>
            <th>POS.</th>
            <th>PRODUIT / DESCRIPTION</th>
            <th>QTÉ</th>
            <th>PRIX UNITAIRE</th>
            {showDiscount && <th>REMISE</th>}
            <th>MONTANT</th>
          </tr>
        </thead>
        <tbody>
          {sections.map((section, sectionIndex) => (
            <Fragment key={section.id}>
              <tr className="section-row">
                <td
                  colSpan={cols}
                  className="doc-section"
                  id={`doc-lot-${sectionIndex + 1}`}
                >
                  {sectionIndex + 1}. {section.title}
                </td>
              </tr>
              {section.groups.map((g, index) => (
                <Fragment key={g.id}>
                  {g.items.map((i, n) =>
                    row(
                      i,
                      `${sectionIndex + 1}.${index + 1}${n ? String.fromCharCode(64 + n) : ""}`,
                      g.selected === i.id,
                      n
                        ? `Alternative à ${g.items[0].name} · Écart ${signedMoney(lineTotal(i) - lineTotal(g.items[0]))}${i.qty !== g.items[0].qty ? " · Quantité différente" : ""}`
                        : "Proposition de base",
                    ),
                  )}
                  {s.extras
                    .filter((e) => e.parent === g.id)
                    .map((e, k) =>
                      row(
                        e,
                        `${sectionIndex + 1}.${index + 1}+${k + 1}`,
                        e.selected,
                        `Option de ${g.items[0].name}`,
                      ),
                    )}
                </Fragment>
              ))}
              <tr className="section-total">
                <td colSpan={cols - 1}>Sous-total {section.title}</td>
                <td>
                  {money(
                    section.groups.reduce(
                      (sum, g) =>
                        sum +
                        lineTotal(g.items.find((i) => i.id === g.selected)!),
                      0,
                    ),
                  )}
                </td>
              </tr>
            </Fragment>
          ))}
          {prestations.length > 0 && (
            <tr>
              <td colSpan={cols} className="doc-section">
                Prestations
              </td>
            </tr>
          )}
          {prestations.map((e, n) =>
            row(
              e,
              `P${n + 1}`,
              e.selected,
              e.chargePercent === null
                ? "Prestation"
                : `Frais ${e.chargePercent} % sur les produits retenus${showDiscount ? " après remises" : ""}`,
            ),
          )}
        </tbody>
      </table>
      <div className="doc-bottom">
        <div>
          <h3>CONDITIONS DE PAIEMENT</h3>
          <p>{s.terms}</p>
          <h3>LIVRAISON ESTIMÉE</h3>
          <p>{s.delivery}</p>
          <h3>REMARQUES</h3>
          <p className="preline">{s.note}</p>
          <h3>CONDITIONS GÉNÉRALES DE VENTE</h3>
          <p className="doc-legal">
            {SALES_TERMS_NOTICE} Consultez-les sur :{" "}
            <a href={SALES_TERMS_URL}>{SALES_TERMS_URL}</a>
          </p>
        </div>
        <div className="docsummary">
          <h3>RÉCAPITULATIF DU PROJET</h3>
          {sections.map((section) => (
            <div key={section.id}>
              <span>{section.title}</span>
              <span>
                {money(
                  section.groups.reduce(
                    (sum, g) =>
                      sum +
                      lineTotal(g.items.find((i) => i.id === g.selected)!),
                    0,
                  ),
                )}
              </span>
            </div>
          ))}
          {breakdown.options !== 0 && (
            <div>
              <span>Options et prestations retenues</span>
              <span>{money(breakdown.options)}</span>
            </div>
          )}
          {breakdown.delivery !== 0 && (
            <div>
              <span>Livraison + montage</span>
              <span>{money(breakdown.delivery)}</span>
            </div>
          )}
          {roundingAdjustment !== 0 && (
            <div>
              <span>Ajustement d’arrondi fiscal</span>
              <span>{signedMoney(roundingAdjustment)}</span>
            </div>
          )}
          <div className="doc-total">
            <strong>Total hors TVA</strong>
            <strong>{money(net)}</strong>
          </div>
          {f.complete ? (
            taxLines.map((l) => (
              <div key={l.rate}>
                <span>TVA {l.rate} %</span>
                <span>{money(l.amount)}</span>
              </div>
            ))
          ) : (
            <div>
              <span>TVA</span>
              <span>À calculer</span>
            </div>
          )}
          {f.complete && taxLines.length > 1 && (
            <div>
              <span>Total TVA</span>
              <span>{money(tax)}</span>
            </div>
          )}
          <div className="doc-total">
            <strong>Total TVAC</strong>
            <strong>{f.complete ? money(gross) : "À calculer"}</strong>
          </div>
          {f.complete &&
            schedule.map((stage) => (
              <div key={stage.label}>
                <span>{stage.label} TVAC</span>
                <strong>{money(stage.amount)}</strong>
              </div>
            ))}
          {demo && (
            <p className="draft-warning">
              Démonstration — sans valeur commerciale.
            </p>
          )}
        </div>
      </div>
      <footer>
        <strong>{seller?.name || "Mikado Deco"}</strong>
        <div className="preline">{seller?.address || "Rue du Doyenné 75"}</div>
        {seller?.email || "shop@mikadodeco.be"} ·{" "}
        {seller?.website || "shop.mikadodeco.be"}
        {seller?.vat && <div>TVA : {seller.vat}</div>}
      </footer>
    </article>
  );
}
