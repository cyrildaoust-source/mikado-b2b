import { useMemo, useState } from "react";
import {
  fiscalTotals,
  lineTotal,
  money,
  optionsOf,
  paymentSchedule,
  quoteSections,
  services,
  type Line,
  type QuoteState,
} from "../domain/quote";
import {
  applyChoices,
  initialChoices,
  type Choices,
} from "../domain/proposal";
import { safeLogo, sellerLines, type Seller } from "../domain/seller";
import { safeImage } from "./LegacyQuoteDocument";

const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-BE", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Brussels",
  });

function Price({ l }: { l: Line }) {
  return (
    <span className="cp-price">
      {money(lineTotal(l))}
      <small>
        {l.qty > 1 && `${l.qty} × ${money(l.price)} `}
        {l.discount > 0 && `remise ${l.discount} % `}
        HTVA
      </small>
    </span>
  );
}

function Photo({ l }: { l: Line }) {
  const src = safeImage(l.image);
  return src ? <img className="cp-photo" src={src} alt="" loading="lazy" /> : null;
}

/**
 * Proposition vue par le client final, pensée pour le téléphone. Le client
 * compare les alternatives et coche les options ; le total suit, calculé comme
 * le devis. Rien n'est envoyé tant que la validation en ligne n'existe pas.
 */
export function ClientProposal({
  state,
  seller,
  number,
  publishedNumber,
  issuedAt,
  expiresAt,
  pdfHref,
}: {
  state: QuoteState;
  seller: Seller | null;
  number: string;
  publishedNumber: number;
  issuedAt: string | null;
  expiresAt: string;
  pdfHref: string;
}) {
  const [choices, setChoices] = useState<Choices>(() => initialChoices(state));
  const s = useMemo(() => applyChoices(state, choices), [state, choices]);
  const f = fiscalTotals(s);
  const schedule = paymentSchedule(s, f.gross);
  const changed =
    JSON.stringify(choices) !== JSON.stringify(initialChoices(state));
  const from = seller?.name || "Mikado Deco";
  const lines = sellerLines(seller);
  const logo = safeLogo(seller?.logo);
  const fixed = services(s).filter((e) => e.selected);
  const delivery = s.extras.find((e) => e.deliveryFee && e.selected);
  const who = [s.firstName, s.lastName].filter(Boolean).join(" ") || s.client;
  return (
    <div className="cp">
      <header className="cp-head">
        {logo && <img className="cp-logo" src={logo} alt={`Logo de ${from}`} />}
        <p className="cp-from">{from}</p>
        <h1>{s.project}</h1>
        <p className="cp-meta">
          {who && <>Proposition pour {who} · </>}
          {number} · révision {publishedNumber}
          {issuedAt && <> · {longDate(issuedAt)}</>}
        </p>
        <p className="cp-validity">
          Prix garantis jusqu'au {longDate(expiresAt)}.
        </p>
      </header>

      {quoteSections(s).map((section) => (
        <section key={section.id} className="cp-section">
          <h2>{section.title}</h2>
          {section.groups.map((g) => {
            const chosen = g.items.find((i) => i.id === g.selected)!;
            const opts = optionsOf(s, g.id).filter((e) => !e.deliveryFee);
            return (
              <article key={g.id} className="cp-product">
                {g.items.length > 1 ? (
                  <fieldset className="cp-choices">
                    <legend>
                      {g.items.length} propositions, choisissez celle qui vous
                      convient
                    </legend>
                    {g.items.map((item) => {
                      const diff = lineTotal(item) - lineTotal(chosen);
                      return (
                        <label
                          key={item.id}
                          className={`cp-line cp-choice${item.id === g.selected ? " is-on" : ""}`}
                        >
                          <input
                            type="radio"
                            name={`g-${g.id}`}
                            checked={item.id === g.selected}
                            onChange={() =>
                              setChoices((c) => ({
                                ...c,
                                groups: { ...c.groups, [g.id]: item.id },
                              }))
                            }
                          />
                          <Photo l={item} />
                          <span className="cp-body">
                            <span className="cp-name">
                              {item.name}
                              {item.id !== g.selected && diff !== 0 && (
                                <small>
                                  {diff > 0 ? "+" : "−"}
                                  {money(Math.abs(diff))} HTVA par rapport à votre choix
                                </small>
                              )}
                            </span>
                            <Price l={item} />
                          </span>
                        </label>
                      );
                    })}
                  </fieldset>
                ) : (
                  <div className="cp-line">
                    <Photo l={chosen} />
                    <span className="cp-body">
                      <span className="cp-name">{chosen.name}</span>
                      <Price l={chosen} />
                    </span>
                  </div>
                )}
                {chosen.detail.trim() && (
                  <details className="cp-detail">
                    <summary>Détails</summary>
                    <p>{chosen.detail}</p>
                  </details>
                )}
                {opts.map((o) => (
                  <label key={o.id} className="cp-line cp-option">
                    <input
                      type="checkbox"
                      checked={o.selected}
                      onChange={(e) =>
                        setChoices((c) => ({
                          ...c,
                          options: { ...c.options, [o.id]: e.target.checked },
                        }))
                      }
                    />
                    <span className="cp-body">
                      <span className="cp-name">Option · {o.name}</span>
                      <Price l={o} />
                    </span>
                  </label>
                ))}
              </article>
            );
          })}
        </section>
      ))}

      {(fixed.length > 0 || delivery) && (
        <section className="cp-section">
          <h2>Prestations</h2>
          <article className="cp-product">
            {fixed.map((e) => (
              <div key={e.id} className="cp-line">
                <span className="cp-body">
                  <span className="cp-name">{e.name}</span>
                  <Price l={e} />
                </span>
              </div>
            ))}
            {delivery && (
              <div className="cp-line">
                <span className="cp-body">
                  <span className="cp-name">
                    {delivery.name}
                    <small>
                      {delivery.chargePercent} % de la marchandise retenue
                    </small>
                  </span>
                  <Price l={delivery} />
                </span>
              </div>
            )}
          </article>
        </section>
      )}

      <section className="cp-section cp-terms">
        <h2>Conditions</h2>
        <dl>
          <dt>Paiement</dt>
          <dd>{s.terms}</dd>
          <dt>Livraison estimée</dt>
          <dd>{s.delivery}</dd>
          {s.note.trim() && (
            <>
              <dt>Remarques</dt>
              <dd className="preline">{s.note}</dd>
            </>
          )}
        </dl>
        <a className="button" href={pdfHref} download>
          Télécharger le PDF
        </a>
      </section>

      <footer className="cp-foot">
        <strong>{from}</strong>
        {lines.address && <span className="preline">{lines.address}</span>}
        {lines.contact.length > 0 && <span>{lines.contact.join(" · ")}</span>}
        {seller?.vat && <span>TVA {seller.vat}</span>}
      </footer>

      <aside className="cp-total" aria-live="polite">
        <details>
          <summary>
            <span>
              Total TVAC
              {changed && <small>selon vos choix</small>}
            </span>
            <strong>{money(f.gross)}</strong>
          </summary>
          <div className="cp-breakdown">
            <div>
              <span>Total HTVA</span>
              <span>{money(f.net)}</span>
            </div>
            {f.taxLines.map((t) => (
              <div key={t.rate}>
                <span>TVA {t.rate} %</span>
                <span>{money(t.amount)}</span>
              </div>
            ))}
            {schedule.map((st) => (
              <div key={st.label}>
                <span>{st.label}</span>
                <span>{money(st.amount)}</span>
              </div>
            ))}
            {changed && (
              <p>
                Vos choix restent sur cet appareil. Pour les confirmer,
                répondez à {from}.
              </p>
            )}
          </div>
        </details>
      </aside>
    </div>
  );
}
