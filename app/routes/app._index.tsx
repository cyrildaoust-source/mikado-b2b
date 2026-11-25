import {
  Form,
  Link,
  redirect,
  useLoaderData,
  useActionData,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "react-router";
import { context, ownerScope } from "../services/context.server";
import { listQuotes, createQuote } from "../services/quotes.server";
import {
  newQuote,
  quoteSchema,
  totals,
  money,
  commercialStatus,
} from "../domain/quote";
import { shopInfo } from "../services/shopify-api.server";
export async function loader({ request }: LoaderFunctionArgs) {
  const c = await context(request),
    u = new URL(request.url),
    search = (u.searchParams.get("q") || "").slice(0, 150),
    filter = u.searchParams.get("status") || "all",
    page = Math.max(1, parseInt(u.searchParams.get("page") || "1") || 1);
  const result = await listQuotes(c.shop, search, filter, page, ownerScope(c));
  return {
    ...result,
    quotes: result.quotes.map((q) => ({
      ...q,
      state: undefined,
      total: totals(quoteSchema.parse(JSON.parse(q.state))).total,
    })),
    search,
    filter,
    demo: c.demo,
  };
}
export async function action({ request }: ActionFunctionArgs) {
  const c = await context(request);
  try {
    const shop = await shopInfo(c.admin);
    if (shop.currencyCode !== "EUR")
      return { error: "Cette version prend en charge les boutiques en EUR." };
    const q = await createQuote(
      c.shop,
      newQuote(shop.taxesIncluded),
      c.user?.id || null,
    );
    return redirect(`/app/quotes/${q.id}`);
  } catch {
    return {
      error:
        "Impossible de créer le devis. Vérifiez la connexion puis réessayez.",
    };
  }
}
export default function Quotes() {
  const { quotes, total, page, pages, search, filter, demo } =
      useLoaderData<typeof loader>(),
    result = useActionData<typeof action>();
  function href(p: number) {
    return (
      "?" + new URLSearchParams({ q: search, status: filter, page: String(p) })
    );
  }
  return (
    <main className="workspace">
      <header className="list-header">
        <div>
          <h1>Devis</h1>
          <p>Vos projets, de la première proposition à la commande.</p>
        </div>
        <Form method="post">
          <button className="primary">Créer un devis</button>
        </Form>
      </header>
      {demo && <p className="demo-ribbon">Démonstration · données fictives</p>}
      {result?.error && (
        <p role="alert" className="error">
          {result.error}
        </p>
      )}
      <div className="list-card">
        <Form method="get" className="list-toolbar">
          <input
            name="q"
            aria-label="Rechercher un devis"
            placeholder="Rechercher par projet, client ou référence"
            defaultValue={search}
          />
          <select
            name="status"
            aria-label="Statut du devis"
            defaultValue={filter}
          >
            <option value="all">Tous les devis actifs</option>
            <option value="draft">Brouillons et modifications</option>
            <option value="ready">Prêts à envoyer · non envoyés</option>
            <option value="sent">Envoyés</option>
            <option value="ordered">Commandes créées</option>
            <option value="archived">Archives</option>
            <option value="deleted">Corbeille</option>
          </select>
          <button>Rechercher</button>
        </Form>
        {quotes.length ? (
          <table className="quote-table">
            <thead>
              <tr>
                <th>Projet</th>
                <th>Client</th>
                <th>Statut</th>
                <th>Total HTVA</th>
                <th>Dernière activité</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => (
                <tr key={q.id}>
                  <td>
                    <Link to={`/app/quotes/${q.id}`}>{q.title}</Link>
                    <small>{q.number}</small>
                  </td>
                  <td>{q.customer || "Client à choisir"}</td>
                  <td>
                    <s-badge
                      tone={
                        commercialStatus(q).startsWith("Prêt")
                          ? "success"
                          : "info"
                      }
                    >
                      {commercialStatus(q)}
                    </s-badge>
                  </td>
                  <td>{money(q.total)}</td>
                  <td>{new Date(q.updatedAt).toLocaleDateString("fr-BE")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">
            <span className="empty-symbol">◇</span>
            <h2>
              {search || filter !== "all"
                ? "Aucun devis trouvé"
                : "Votre premier projet commence ici"}
            </h2>
            <p>
              {search || filter !== "all"
                ? "Essayez un autre nom ou un autre filtre."
                : "Choisissez un client, composez votre proposition et préparez son PDF."}
            </p>
          </div>
        )}
        <footer className="pagination">
          <span>
            {total} devis · page {page} sur {pages}
          </span>
          <div>
            {page > 1 && <Link to={href(page - 1)}>Précédent</Link>}
            {page < pages && <Link to={href(page + 1)}>Suivant</Link>}
          </div>
        </footer>
      </div>
    </main>
  );
}
