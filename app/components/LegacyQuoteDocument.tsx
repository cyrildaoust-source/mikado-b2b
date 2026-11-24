import { Fragment } from "react";
import {
  lineTotal,
  money,
  totals,
  type QuoteState,
  type Line,
} from "../domain/quote";
import { SALES_TERMS_NOTICE, SALES_TERMS_URL } from "../domain/legal";
export function safeImage(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "cdn.shopify.com"
      ? url
      : "";
  } catch {
    return "";
  }
}
export function LegacyQuoteDocument({
  state: s,
  number,
  version,
  demo = false,
}: {
  state: QuoteState;
  number: string;
  version: number;
  demo?: boolean;
}) {
  const t = totals(s),
    basis = s.taxesIncluded ? "TTC" : "HT";
  const address = (a: QuoteState["shipping"]) =>
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
  const row = (i: Line, caption: string) => (
    <tr key={i.id}>
      <td>
        <div className="doc-product">
          {safeImage(i.image) ? (
            <img src={safeImage(i.image)} alt="" />
          ) : (
            <span className="doc-thumb">—</span>
          )}
          <div>
            <strong>{i.name}</strong>
            <br />
            {i.sku}
            <small>{caption}</small>
          </div>
        </div>
      </td>
      <td>{i.sku || "—"}</td>
      <td>{i.qty}</td>
      <td>{money(i.price)}</td>
      <td>{i.discount ? `${i.discount} %` : "—"}</td>
      <td>{money(lineTotal(i))}</td>
    </tr>
  );
  return (
    <article className="paper">
      <div className="runninghead">
        <span>Mikado Deco</span>
        <span>#{number}</span>
      </div>
      <div className="paperheader">
        <h1>Mikado Deco</h1>
        <div>
          DEVIS #{number}
          <br />
          Version {version}
        </div>
      </div>
      <div className="doc-addresses">
        <div>
          <h3>CLIENT</h3>
          {s.client}
          <br />
          {s.contact}
          <br />
          {s.email}
        </div>
        <div>
          <h3>LIVRER À</h3>
          <div className="preline">{address(s.shipping)}</div>
        </div>
        <div>
          <h3>FACTURER À</h3>
          <div className="preline">
            {address(s.billingSame ? s.shipping : s.billing)}
          </div>
          {s.customerVat && <p>N° TVA client : {s.customerVat}</p>}
        </div>
      </div>
      <div className="doc-addresses">
        <div>
          <h3>MODALITÉS DE PAIEMENT</h3>
          {s.terms}
        </div>
        <div>
          <h3>DEVISE</h3>EUR
        </div>
        <div>
          <h3>LIVRAISON ESTIMÉE</h3>
          {s.delivery}
        </div>
      </div>
      <div className="doc-project">
        <strong>{s.project}</strong>
        <span>
          Valable jusqu’au {s.validity.split("-").reverse().join("/")}
        </span>
      </div>
      <table>
        <thead>
          <tr>
            <th>PRODUITS</th>
            <th>RÉFÉRENCE</th>
            <th>QTÉ</th>
            <th>PRIX {basis}</th>
            <th>REMISE</th>
            <th>TOTAL (EUR)</th>
          </tr>
        </thead>
        <tbody>
          {s.groups.map((g, index) => (
            <Fragment key={g.id}>
              {(index === 0 || g.section !== s.groups[index - 1].section) &&
                g.section && (
                  <tr key={"section-" + g.id}>
                    <td colSpan={6} className="doc-section">
                      {g.section}
                    </td>
                  </tr>
                )}
              {g.items.map((i, n) =>
                row(
                  i,
                  n
                    ? `Alternative à ${g.items[0].name} : ${money(lineTotal(i) - lineTotal(g.items[0]))}`
                    : "Proposition de base",
                ),
              )}
            </Fragment>
          ))}
          {s.extras.map((e) => row(e, "Option supplémentaire - hors base"))}
        </tbody>
      </table>
      <div className="doc-bottom">
        <div>
          <h3>RÉFÉRENCE DU PROJET</h3>
          <p>{s.project}</p>
          <h3>REMARQUES POUR LE CLIENT</h3>
          <p className="preline">{s.note}</p>
          <h3>CONDITIONS GÉNÉRALES DE VENTE</h3>
          <p className="doc-legal">
            {SALES_TERMS_NOTICE} Consultez-les sur :{" "}
            <a href={SALES_TERMS_URL}>{SALES_TERMS_URL}</a>
          </p>
        </div>
        <div className="docsummary">
          <h3>RÉSUMÉ DU DEVIS</h3>
          <div>
            <span>Sous-total de base {basis}</span>
            <span>{money(t.base)}</span>
          </div>
          <div>
            <span>Écart des alternatives retenues</span>
            <span>{money(t.delta)}</span>
          </div>
          <div>
            <span>Options retenues {basis}</span>
            <span>{money(t.extras)}</span>
          </div>
          <div className="doc-total">
            <strong>Total retenu {basis}</strong>
            <strong>{money(t.total)}</strong>
          </div>
          <p className="muted">
            {s.taxesIncluded
              ? "Prix issus d’un catalogue taxes incluses."
              : "Taxes en sus, à confirmer selon le contexte de livraison."}
          </p>
          <p>
            Choix retenus :{" "}
            {s.groups
              .map((g) => g.items.find((i) => i.id === g.selected)!.name)
              .concat(s.extras.filter((e) => e.selected).map((e) => e.name))
              .join(" · ")}
          </p>
        </div>
      </div>
      <footer>
        <strong>Mikado Deco</strong>
        <br />
        Rue du Doyenné 75
        <br />
        shop@mikadodeco.be
        <br />
        https://shop.mikadodeco.be
        {demo && <p>EXEMPLE - données fictives, sans valeur commerciale.</p>}
      </footer>
    </article>
  );
}
