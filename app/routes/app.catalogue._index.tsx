import { useEffect, useRef } from "react";
import {
  Form,
  Link,
  useLoaderData,
  useNavigation,
  useSubmit,
  type LoaderFunctionArgs,
} from "react-router";
import { context, ownerScope } from "../services/context.server";
import { currentQuoteId, quotePanel } from "../services/current-quote.server";
import {
  brandFamilies,
  catalogFacets,
  listCatalog,
} from "../services/catalog.server";
import { money } from "../domain/quote";
import { sized } from "../components/catalog/image";

export async function loader({ request }: LoaderFunctionArgs) {
  const c = await context(request),
    u = new URL(request.url),
    filters = {
      vendors: [...new Set(u.searchParams.getAll("marque"))]
        .map((v) => v.slice(0, 150))
        .filter(Boolean)
        .slice(0, 30),
      type: (u.searchParams.get("famille") || "").slice(0, 150),
      q: (u.searchParams.get("q") || "").slice(0, 150),
      after: u.searchParams.get("apres") || undefined,
    };
  try {
    // Devis ouvert : permet l'ajout rapide depuis une carte (action de la fiche produit).
    const openQuote = await currentQuoteId(request)
      .then((id) => quotePanel(c.shop, id, ownerScope(c)))
      .catch(() => null);
    const [list, facets, families] = await Promise.all([
      listCatalog(c.admin, filters),
      catalogFacets(c.admin),
      brandFamilies(c.admin, filters.vendors).catch(() => []),
    ]);
    return { ...list, facets, families, filters, openQuote, demo: c.demo, error: null };
  } catch {
    return {
      items: [],
      next: null,
      facets: { vendors: [], types: [] },
      families: [] as { type: string; count: number }[],
      filters,
      openQuote: null,
      demo: c.demo,
      error: "Catalogue indisponible pour le moment. Réessayez dans un instant.",
    };
  }
}

export default function Catalogue() {
  const { items, next, facets, families, filters, demo, error } =
    useLoaderData<typeof loader>();
  // Chaque filtre s'applique tout de suite : pas de bouton « Afficher ».
  const submit = useSubmit(),
    timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const picker = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (picker.current && !picker.current.contains(e.target as Node))
        picker.current.open = false;
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const apply = (form: HTMLFormElement, delay = 0) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => submit(form, { replace: true }), delay);
  };
  const link = (over: { famille?: string; apres?: string }) => {
    const p = new URLSearchParams();
    if (filters.q) p.set("q", filters.q);
    filters.vendors.forEach((v) => p.append("marque", v));
    const famille = over.famille ?? filters.type;
    if (famille) p.set("famille", famille);
    if (over.apres) p.set("apres", over.apres);
    return `?${p}`;
  };
  const busy = useNavigation().state === "loading";
  const brandLabel = filters.vendors.length
    ? filters.vendors.length === 1
      ? filters.vendors[0]
      : `${filters.vendors.length} marques`
    : "Toutes les marques";
  return (
    <main className="workspace catalogue">
      <header className="list-header">
        <div>
          <h1>Catalogue</h1>
          <p>Toutes les marques Mikado Deco. Prix publics HTVA.</p>
        </div>
      </header>
      {demo && <p className="demo-ribbon">Démonstration · catalogue fictif</p>}
      <Form method="get" className="catalogue-filters">
        <input
          name="q"
          type="search"
          aria-label="Rechercher"
          placeholder="Produit, designer, référence…"
          defaultValue={filters.q}
          onChange={(e) => apply(e.currentTarget.form!, 400)}
        />
        <details className="brand-picker" ref={picker}>
          <summary>{brandLabel}</summary>
          <div className="brand-picker-list">
            {facets.vendors.map((v) => (
              <label key={v}>
                <input
                  type="checkbox"
                  name="marque"
                  value={v}
                  defaultChecked={filters.vendors.includes(v)}
                  onChange={(e) => {
                    const form = e.currentTarget.form!;
                    (form.elements.namedItem("famille") as HTMLSelectElement).value = "";
                    apply(form);
                  }}
                />
                {v}
              </label>
            ))}
          </div>
        </details>
        <select
          name="famille"
          aria-label="Famille"
          defaultValue={filters.type}
          key={filters.vendors.join("|")}
          onChange={(e) => apply(e.currentTarget.form!)}
        >
          <option value="">Toutes les familles</option>
          {(families.length ? families.map((f) => f.type) : facets.types).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {(filters.q || filters.vendors.length > 0 || filters.type) && (
          <Link to="/app/catalogue" reloadDocument>
            Effacer
          </Link>
        )}
      </Form>
      {filters.vendors.length > 0 && (
        <nav className="family-chips" aria-label="Familles">
          <Link to={link({ famille: "" })} className={filters.type ? "" : "active"}>
            Tout {filters.vendors.length === 1 ? filters.vendors[0] : "les marques choisies"}
          </Link>
          {families.map((f) => (
            <Link
              key={f.type}
              to={link({ famille: f.type })}
              className={filters.type === f.type ? "active" : ""}
            >
              {f.type} <span>{f.count}</span>
            </Link>
          ))}
        </nav>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {busy && <p role="status">Chargement…</p>}
      {items.length ? (
        <ul className="catalogue-grid">
          {items.map((p) => (
            <li key={p.id}>
              <Link
                to={`/app/catalogue/${p.numericId}?variante=${p.variantNumericId}`}
                className="catalogue-card"
              >
                <div className="catalogue-photo">
                  {p.image ? (
                    <img
                      src={sized(p.image, 600)}
                      alt={p.imageAlt}
                      loading="lazy"
                    />
                  ) : (
                    <span>Photo à venir</span>
                  )}
                </div>
                <div className="catalogue-meta">
                  <small>{p.vendor}</small>
                  <strong>{p.title}</strong>
                  {p.variantTitle && (
                    <span className="catalogue-finish">{p.variantTitle}</span>
                  )}
                  <span>{money(p.minPrice)} HTVA</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        !error && (
          <div className="empty-state">
            <span className="empty-symbol">◇</span>
            <h2>Aucun produit trouvé</h2>
            <p>Essayez une autre marque, une autre famille ou un autre mot.</p>
          </div>
        )
      )}
      {next && (
        <p className="catalogue-more">
          <Link to={link({ apres: next })}>Voir la suite</Link>
        </p>
      )}
    </main>
  );
}
