import { Form, Link } from "react-router";
import { money } from "../../domain/quote";
import { FOLLOW_UP_DAYS } from "../../domain/dashboard";
import type {
  Dashboard,
  DashboardQuote,
} from "../../services/dashboard.server";

// Accueil de l'outil pro : « Bonjour », les chiffres du moment, ce qu'il y a à
// faire, puis les devis en attente du client et les commandes en cours.

const TZ = "Europe/Brussels";
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-BE", {
    day: "numeric",
    month: "short",
    timeZone: TZ,
  });
const fullDay = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-BE", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: TZ,
  });
const ago = (n: number | null) =>
  n === null
    ? ""
    : n <= 0
      ? "aujourd'hui"
      : n === 1
        ? "hier"
        : `il y a ${n} jours`;
const plural = (n: number, one: string, many: string) =>
  `${n} ${n > 1 ? many : one}`;

type Todo = {
  q: DashboardQuote;
  text: string;
  tone: "warning" | "critical" | "info";
  rank: number;
};

/** Ce qu'il y a à faire, du plus urgent au moins urgent. */
function todos(quotes: DashboardQuote[]): Todo[] {
  const out: Todo[] = [];
  for (const q of quotes) {
    if (q.stage === "check")
      out.push({
        q,
        rank: 0,
        tone: "critical",
        text: "Commande à vérifier par Mikado Deco",
      });
    if (q.stage === "sent" && q.validityLeft !== null && q.validityLeft < 0)
      out.push({
        q,
        rank: 1,
        tone: "critical",
        text: `Validité dépassée depuis le ${day(q.validity + "T12:00:00Z")} : prolongez-la ou faites une nouvelle version`,
      });
    else if (
      q.stage === "sent" &&
      q.validityLeft !== null &&
      q.validityLeft <= 7
    )
      out.push({
        q,
        rank: 2,
        tone: "warning",
        text:
          q.validityLeft === 0
            ? "Dernier jour de validité"
            : `Valable encore ${plural(q.validityLeft, "jour", "jours")}`,
      });
    else if (q.stage === "sent" && (q.sentDays ?? 0) >= FOLLOW_UP_DAYS)
      out.push({
        q,
        rank: 3,
        tone: "warning",
        text: `Relancer le client : devis envoyé ${ago(q.sentDays)}`,
      });
    if (q.stage === "ready")
      out.push({
        q,
        rank: 4,
        tone: "info",
        text: `PDF prêt : envoyez la révision R${q.revision} au client`,
      });
  }
  return out.sort((a, b) => a.rank - b.rank).slice(0, 8);
}

function LeadText({ q }: { q: DashboardQuote }) {
  if (!q.leadProducts)
    return <span className="muted">Pas de produit du catalogue</span>;
  if (!q.lead) return <span className="muted">Délai non renseigné</span>;
  return (
    <>
      {q.lead === "sur demande" ? "Délai sur demande" : q.lead}
      {q.leadMissing > 0 && (
        <small>
          {plural(q.leadMissing, "produit sans délai", "produits sans délai")}
        </small>
      )}
    </>
  );
}

function Who({ q, admin }: { q: DashboardQuote; admin: boolean }) {
  return (
    <>
      {q.customer || "Client à choisir"}
      {admin && q.owner && <small>{q.owner}</small>}
    </>
  );
}

function Project({ q }: { q: DashboardQuote }) {
  return (
    <>
      <Link to={`/app/quotes/${q.id}`}>{q.title}</Link>
      <small>
        {q.number}
        {q.editing && " · nouvelle version en cours"}
      </small>
    </>
  );
}

export function DashboardView({
  data,
  name,
  admin,
  demo,
  error,
}: {
  data: Dashboard;
  name: string;
  admin: boolean;
  demo: boolean;
  error?: string;
}) {
  const { quotes, counts } = data;
  const sent = quotes
    .filter((q) => q.stage === "sent")
    .sort((a, b) => (a.sentAt || "").localeCompare(b.sentAt || ""));
  const ordered = quotes.filter((q) => q.stage === "ordered").slice(0, 12);
  const preparing = quotes
    .filter((q) => q.stage === "draft" || q.stage === "ready")
    .slice(0, 5);
  const todo = todos(quotes);
  const todayIso = new Date().toISOString().slice(0, 10);
  const today = new Date().toLocaleDateString("fr-BE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: TZ,
  });
  const summary = [
    counts.sent &&
      `${plural(counts.sent, "devis attend", "devis attendent")} la réponse ${counts.sent > 1 ? "des clients" : "du client"}`,
    data.followUps &&
      `${plural(data.followUps, "est à relancer", "sont à relancer")}`,
    counts.ordered &&
      `${plural(counts.ordered, "commande", "commandes")} en cours`,
  ].filter(Boolean);

  return (
    <main className="workspace dashboard">
      <header className="dash-head">
        <div>
          <p className="dash-date">{today}</p>
          <h1>{name ? `Bonjour ${name}` : "Bonjour"}</h1>
          <p className="dash-summary">
            {quotes.length
              ? summary.length
                ? summary.join(", ").replace(/^./, (c) => c.toUpperCase()) + "."
                : "Aucun devis n'attend de réponse pour le moment."
              : "Bienvenue dans l'outil pro de Mikado Deco."}
          </p>
        </div>
        <div className="dash-actions">
          <Link className="button" to="/app/catalogue">
            Parcourir le catalogue
          </Link>
          <Form method="post" action="/app/devis">
            <button className="primary">Nouveau devis</button>
          </Form>
        </div>
      </header>
      {demo && (
        <p className="demo-ribbon">Démonstration · données et délais fictifs</p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {data.shopifyError && (
        <p className="notice">
          Les délais et l'état des commandes n'ont pas pu être lus dans Shopify.
          Rechargez la page dans un instant.
        </p>
      )}

      {!quotes.length ? (
        <div className="list-card">
          <div className="empty-state">
            <h2>Votre premier projet commence ici</h2>
            <p>
              Choisissez des produits dans le catalogue, composez votre
              proposition par pièce et préparez son PDF. Vos devis et leurs
              statuts s'afficheront sur cette page.
            </p>
            <Form method="post" action="/app/devis">
              <button className="primary">Créer un devis</button>
            </Form>
          </div>
        </div>
      ) : (
        <>
          <nav className="dash-stats" aria-label="Vos devis par statut">
            <Link to="/app/devis?status=draft" className="dash-stat">
              <span>En préparation</span>
              <strong>{counts.draft}</strong>
              <small>
                {counts.ready
                  ? `+ ${plural(counts.ready, "prêt à envoyer", "prêts à envoyer")}`
                  : "brouillons et modifications"}
              </small>
            </Link>
            <Link to="/app/devis?status=sent" className="dash-stat">
              <span>En attente du client</span>
              <strong>{counts.sent}</strong>
              <small>
                {counts.sent
                  ? `${money(data.sentTotal)} HTVA`
                  : "aucun devis envoyé"}
              </small>
            </Link>
            <Link to="/app/devis?status=ordered" className="dash-stat">
              <span>Acceptés</span>
              <strong>{counts.ordered}</strong>
              <small>
                {counts.ordered
                  ? `${money(data.orderedTotal)} HTVA`
                  : "aucune commande"}
              </small>
            </Link>
            <Link
              to="/app/devis?status=sent"
              className={`dash-stat${data.followUps ? " dash-stat-alert" : ""}`}
            >
              <span>À relancer</span>
              <strong>{data.followUps}</strong>
              <small>{FOLLOW_UP_DAYS} jours sans réponse</small>
            </Link>
          </nav>

          {todo.length > 0 && (
            <section
              className="list-card dash-section"
              aria-labelledby="dash-todo"
            >
              <h2 id="dash-todo">À faire</h2>
              <ul className="dash-todo">
                {todo.map((t) => (
                  <li key={`${t.q.id}-${t.rank}`}>
                    <s-badge tone={t.tone}>
                      {t.tone === "info"
                        ? "À envoyer"
                        : t.tone === "critical"
                          ? "Urgent"
                          : "À suivre"}
                    </s-badge>
                    <Link to={`/app/quotes/${t.q.id}`}>
                      <strong>{t.q.title}</strong>
                      <span>
                        {t.q.customer && `${t.q.customer} · `}
                        {t.text}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section
            className="list-card dash-section"
            aria-labelledby="dash-sent"
          >
            <div className="dash-section-head">
              <h2 id="dash-sent">En attente du client</h2>
              {counts.sent > 0 && (
                <Link to="/app/devis?status=sent">Voir tout</Link>
              )}
            </div>
            {sent.length ? (
              <table className="dash-table">
                <thead>
                  <tr>
                    <th>Projet</th>
                    <th>Client</th>
                    <th>Envoyé</th>
                    <th>Valable jusqu'au</th>
                    <th>Délai le plus long</th>
                    <th>Total HTVA</th>
                  </tr>
                </thead>
                <tbody>
                  {sent.slice(0, 12).map((q) => (
                    <tr key={q.id}>
                      <td data-label="Projet">
                        <Project q={q} />
                      </td>
                      <td data-label="Client">
                        <Who q={q} admin={admin} />
                      </td>
                      <td data-label="Envoyé">
                        {q.sentAt ? day(q.sentAt) : "—"}
                        <small
                          className={
                            (q.sentDays ?? 0) >= FOLLOW_UP_DAYS
                              ? "dash-late"
                              : undefined
                          }
                        >
                          {ago(q.sentDays)}
                          {q.revision ? ` · R${q.revision}` : ""}
                        </small>
                      </td>
                      <td data-label="Valable jusqu'au">
                        {q.validity ? day(q.validity + "T12:00:00Z") : "—"}
                        {q.validityLeft !== null && q.validityLeft < 0 && (
                          <small className="dash-late">dépassée</small>
                        )}
                      </td>
                      <td data-label="Délai le plus long">
                        <LeadText q={q} />
                      </td>
                      <td data-label="Total HTVA" className="dash-num">
                        {money(q.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="dash-empty">
                Aucun devis envoyé en attente. Dans un devis, « Marquer comme
                envoyé » le fait apparaître ici, avec la date d'envoi.
              </p>
            )}
          </section>

          <section
            className="list-card dash-section"
            aria-labelledby="dash-orders"
          >
            <div className="dash-section-head">
              <h2 id="dash-orders">Devis acceptés et commandes</h2>
              {counts.ordered > 0 && (
                <Link to="/app/devis?status=ordered">Voir tout</Link>
              )}
            </div>
            {ordered.length ? (
              <>
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>Projet</th>
                      <th>Client</th>
                      <th>Commande</th>
                      <th>Délai annoncé</th>
                      <th>Arrivée chez Mikado</th>
                      <th>Total HTVA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ordered.map((q) => (
                      <tr key={q.id}>
                        <td data-label="Projet">
                          <Project q={q} />
                        </td>
                        <td data-label="Client">
                          <Who q={q} admin={admin} />
                        </td>
                        <td data-label="Commande">
                          <s-badge
                            tone={
                              q.delivery === "Livrée"
                                ? "success"
                                : q.delivery === "Commande annulée"
                                  ? "critical"
                                  : undefined
                            }
                          >
                            {q.confirmed
                              ? q.delivery || "Confirmée"
                              : "Provisoire"}
                          </s-badge>
                          <small>
                            {q.orderName}
                            {q.orderedAt && ` · ${day(q.orderedAt)}`}
                          </small>
                        </td>
                        <td data-label="Délai annoncé">
                          <LeadText q={q} />
                        </td>
                        <td data-label="Arrivée chez Mikado">
                          {q.delivery === "Livrée" ? (
                            "Livrée"
                          ) : q.arrival ? (
                            <>
                              {day(q.arrival.from) === day(q.arrival.to)
                                ? `Vers le ${day(q.arrival.to)}`
                                : `Du ${day(q.arrival.from)} au ${day(q.arrival.to)}`}
                              {q.arrival.to < todayIso ? (
                                <small className="dash-late">
                                  date passée : à confirmer avec Mikado Deco
                                </small>
                              ) : (
                                q.leadMissing > 0 && (
                                  <small>estimation partielle</small>
                                )
                              )}
                            </>
                          ) : q.confirmed ? (
                            <span className="muted">
                              {q.lead === "sur demande"
                                ? "Sur demande"
                                : "À confirmer"}
                            </span>
                          ) : (
                            <span className="muted">Dès la confirmation</span>
                          )}
                        </td>
                        <td data-label="Total HTVA" className="dash-num">
                          {money(q.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="dash-note">
                  Délai annoncé par la marque jusqu'à la boutique, pour le
                  produit le plus long à arriver, compté en jours ouvrés depuis
                  la commande. Une estimation, pas un engagement : Mikado Deco
                  confirme la date de livraison.
                </p>
              </>
            ) : (
              <p className="dash-empty">
                Aucune commande pour le moment. Quand un client accepte, Mikado
                Deco crée la commande et elle apparaît ici avec son délai.
              </p>
            )}
          </section>

          {preparing.length > 0 && (
            <section
              className="list-card dash-section"
              aria-labelledby="dash-prep"
            >
              <div className="dash-section-head">
                <h2 id="dash-prep">En préparation</h2>
                <Link to="/app/devis">Tous les devis</Link>
              </div>
              <ul className="dash-recent">
                {preparing.map((q) => (
                  <li key={q.id}>
                    <Link to={`/app/quotes/${q.id}`}>
                      <strong>{q.title}</strong>
                      <span>
                        {q.customer || "Client à choisir"}
                        {admin && q.owner && ` · ${q.owner}`}
                        {q.editing && " · une révision est déjà chez le client"}
                      </span>
                    </Link>
                    <s-badge tone={q.stage === "ready" ? "success" : undefined}>
                      {q.label}
                    </s-badge>
                    <span className="dash-recent-meta">
                      {money(q.total)}
                      <small>modifié le {fullDay(q.updatedAt)}</small>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {data.truncated && (
            <p className="dash-note">
              Le tableau de bord compte les 300 devis les plus récents.
            </p>
          )}
        </>
      )}
    </main>
  );
}
