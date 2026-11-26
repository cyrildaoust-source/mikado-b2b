import { useEffect, useMemo, useRef, useState } from "react";
import { Form, useNavigation } from "react-router";
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
  decision = null,
  error,
}: {
  /** Décision déjà enregistrée : la page passe en lecture seule. */
  decision?: {
    name: string;
    acceptedAt: string;
    choices: Choices;
  } | null;
  error?: string;
  state: QuoteState;
  seller: Seller | null;
  number: string;
  publishedNumber: number;
  issuedAt: string | null;
  expiresAt: string;
  pdfHref: string;
}) {
  const [picked, setChoices] = useState<Choices>(() => initialChoices(state));
  const choices = decision?.choices ?? picked;
  const locked = Boolean(decision);
  const busy = useNavigation().state !== "idle";
  // Sur grand écran, le récapitulatif est une colonne ouverte à droite.
  const summary = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (window.matchMedia("(min-width: 1024px)").matches && summary.current)
      summary.current.open = true;
  }, []);
  const s = useMemo(() => applyChoices(state, choices), [state, choices]);
  const f = fiscalTotals(s);
  const schedule = paymentSchedule(s, f.gross);
  const changed =
    !locked && JSON.stringify(choices) !== JSON.stringify(initialChoices(state));
  const from = seller?.name || "Mikado Deco";
  const lines = sellerLines(seller);
  const logo = safeLogo(seller?.logo);
  const fixed = services(s).filter((e) => e.selected);
  const delivery = s.extras.find((e) => e.deliveryFee && e.selected);
  const who = [s.firstName, s.lastName].filter(Boolean).join(" ") || s.client;
  return (
    <div className="cp">
      {decision && (
        <p className="cp-accepted" role="status">
          Proposition acceptée par {decision.name} le{" "}
          {new Date(decision.acceptedAt).toLocaleString("fr-BE", {
            dateStyle: "long",
            timeStyle: "short",
            timeZone: "Europe/Brussels",
          })}
          . {from} revient vers vous pour la suite.
        </p>
      )}
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
                            disabled={locked}
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
                      disabled={locked}
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

      {!locked && (
        <section className="cp-section cp-accept" id="accepter">
          <h2>Accepter la proposition</h2>
          <p className="cp-note">
            Vous acceptez la proposition telle que composée ci-dessus, pour{" "}
            <strong>{money(f.gross)} TVAC</strong>. {from} confirme ensuite la
            commande.
          </p>
          <Form method="post" className="cp-form">
            <input type="hidden" name="choices" value={JSON.stringify(choices)} />
            <div className="cp-names">
              <label>
                Prénom
                <input name="firstName" autoComplete="given-name" required maxLength={80} />
              </label>
              <label>
                Nom
                <input name="lastName" autoComplete="family-name" required maxLength={80} />
              </label>
            </div>
            <label>
              Remarque pour {from} (facultatif)
              <textarea name="remark" rows={3} maxLength={2000} />
            </label>
            <label className="cp-agree">
              <input type="checkbox" name="agree" required />
              <span>
                J'accepte cette proposition et je m'engage à la payer selon les
                conditions indiquées.
              </span>
            </label>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button className="primary" name="intent" value="accept" disabled={busy}>
              {busy ? "Envoi…" : "Accepter le devis avec obligation de paiement"}
            </button>
          </Form>
        </section>
      )}

      <footer className="cp-foot">
        <strong>{from}</strong>
        {lines.address && <span className="preline">{lines.address}</span>}
        {lines.contact.length > 0 && <span>{lines.contact.join(" · ")}</span>}
        {seller?.vat && <span>TVA {seller.vat}</span>}
      </footer>

      <aside className="cp-total" aria-live="polite">
        <details ref={summary}>
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
            {!locked && (
              <a className="cp-to-accept" href="#accepter">
                Accepter la proposition
              </a>
            )}
          </div>
        </details>
      </aside>
    </div>
  );
}
