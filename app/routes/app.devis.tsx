import { useRef } from "react";
import {
  Form,
  Link,
  redirect,
  useLoaderData,
  useActionData,
  useNavigation,
  useSubmit,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
  useLocation,
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
import { FOLLOW_UP_DAYS } from "../domain/dashboard";

export const meta = () => [{ title: "Devis · Mikado Deco Pro" }];
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
  // Recherche et filtre s'appliquent seuls, sans bouton Rechercher.
  const submit = useSubmit();
  const navigation = useNavigation();
  // /app/devis dans l'outil pro ; /app dans l'admin Shopify, où l'accueil reste la liste.
  const base = useLocation().pathname;
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const busy =
    navigation.state === "loading" && navigation.location?.pathname === base;
  function apply(form: HTMLFormElement | null, delay = 0) {
    if (!form) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(
      () => submit(form, { replace: true, preventScrollReset: true }),
      delay,
    );
  }
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
            type="search"
            onChange={(e) => apply(e.currentTarget.form, 250)}
            name="q"
            aria-label="Rechercher un devis"
            placeholder="Projet, client ou référence"
            defaultValue={search}
          />
          <select
            name="status"
            aria-label="Statut du devis"
            defaultValue={filter}
            onChange={(e) => apply(e.currentTarget.form)}
          >
            <option value="all">Tous les devis actifs</option>
            <option value="open">Ouverts · non envoyés</option>
            <option value="draft">Brouillons et modifications</option>
            <option value="ready">Prêts à envoyer · non envoyés</option>
            <option value="sent">Envoyés</option>
            <option value="relance">À relancer · {FOLLOW_UP_DAYS} jours sans réponse</option>
            <option value="ordered">Commandes créées</option>
            <option value="archived">Archives</option>
            <option value="deleted">Corbeille</option>
          </select>
          <noscript>
            <button>Rechercher</button>
          </noscript>
        </Form>
        {quotes.length ? (
          <table className="quote-table" aria-busy={busy}>
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
          <EmptyList search={search} filter={filter} />
        )}
        {total > 0 && (
          <footer className="pagination">
            <span>
              {total} devis
              {pages > 1 && ` · page ${page} sur ${pages}`}
            </span>
            {pages > 1 && (
              <div>
                {page > 1 && (
                  <Link className="button" to={href(page - 1)}>
                    Précédent
                  </Link>
                )}
                {page < pages && (
                  <Link className="button" to={href(page + 1)}>
                    Suivant
                  </Link>
                )}
              </div>
            )}
          </footer>
        )}
      </div>
    </main>
  );
}

const EMPTY: Record<string, [string, string]> = {
  draft: ["Aucun brouillon", "Les devis en cours de rédaction apparaîtront ici."],
  ready: ["Aucun devis prêt à envoyer", "Un devis complet, pas encore envoyé, apparaîtra ici."],
  sent: ["Aucun devis envoyé", "Les devis envoyés au client apparaîtront ici."],
  ordered: ["Aucune commande", "Les devis transformés en commande apparaîtront ici."],
  archived: ["Aucun devis archivé", "Les devis que vous archivez sont rangés ici."],
  deleted: ["La corbeille est vide", "Les devis supprimés restent ici, prêts à être restaurés."],
};

/** État vide : un premier devis à créer, ou une recherche sans résultat
 * qu'on efface d'un clic. */
function EmptyList({ search, filter }: { search: string; filter: string }) {
  const base = useLocation().pathname;
  if (search)
    return (
      <div className="empty-state">
        <h2>Aucun devis pour « {search} »</h2>
        <p>Vérifiez l'orthographe, ou cherchez un client ou une référence.</p>
        <Link
          className="button"
          to={filter === "all" ? base : `${base}?status=${filter}`}
        >
          Effacer la recherche
        </Link>
      </div>
    );
  if (filter !== "all") {
    const [title, text] = EMPTY[filter] || ["Aucun devis", ""];
    return (
      <div className="empty-state">
        <h2>{title}</h2>
        {text && <p>{text}</p>}
        <Link className="button" to={base}>
          Voir tous les devis
        </Link>
      </div>
    );
  }
  return (
    <div className="empty-state">
      <h2>Votre premier projet commence ici</h2>
      <p>
        Choisissez un client, composez votre proposition et préparez son PDF.
      </p>
      <Form method="post">
        <button className="primary">Créer un devis</button>
      </Form>
    </div>
  );
}
