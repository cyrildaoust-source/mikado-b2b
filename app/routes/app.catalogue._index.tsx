import {
  Form,
  Link,
  useLoaderData,
  useNavigation,
  type LoaderFunctionArgs,
} from "react-router";
import { context } from "../services/context.server";
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
      vendor: (u.searchParams.get("marque") || "").slice(0, 150),
      type: (u.searchParams.get("famille") || "").slice(0, 150),
      q: (u.searchParams.get("q") || "").slice(0, 150),
      after: u.searchParams.get("apres") || undefined,
    };
  try {
    const [list, facets, families] = await Promise.all([
      listCatalog(c.admin, filters),
      catalogFacets(c.admin),
      brandFamilies(c.admin, filters.vendor).catch(() => []),
    ]);
    return { ...list, facets, families, filters, demo: c.demo, error: null };
  } catch {
    return {
      items: [],
      next: null,
      facets: { vendors: [], types: [] },
      families: [] as { type: string; count: number }[],
      filters,
      demo: c.demo,
      error: "Catalogue indisponible pour le moment. Réessayez dans un instant.",
    };
  }
}

export default function Catalogue() {
  const { items, next, facets, families, filters, demo, error } =
    useLoaderData<typeof loader>();
  const family = (type: string) =>
    "?" + new URLSearchParams({ q: filters.q, marque: filters.vendor, famille: type });
  const busy = useNavigation().state === "loading";
  const more = new URLSearchParams({
    q: filters.q,
    marque: filters.vendor,
    famille: filters.type,
    ...(next ? { apres: next } : {}),
  });
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
          aria-label="Rechercher"
          placeholder="Produit, designer, référence…"
          defaultValue={filters.q}
        />
        <select
          name="marque"
          aria-label="Marque"
          defaultValue={filters.vendor}
          onChange={(e) => {
            const form = e.currentTarget.form!;
            (form.elements.namedItem("famille") as HTMLSelectElement).value = "";
            form.requestSubmit();
          }}
        >
          <option value="">Toutes les marques</option>
          {facets.vendors.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <select
          name="famille"
          aria-label="Famille"
          defaultValue={filters.type}
          onChange={(e) => e.currentTarget.form!.requestSubmit()}
        >
          <option value="">Toutes les familles</option>
          {(families.length ? families.map((f) => f.type) : facets.types).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button className="primary">Afficher</button>
        {(filters.q || filters.vendor || filters.type) && (
          <Link to="/app/catalogue">Effacer</Link>
        )}
      </Form>
      {families.length > 1 && (
        <nav className="family-chips" aria-label={`Familles ${filters.vendor}`}>
          <Link
            to={family("")}
            className={filters.type ? "" : "active"}
          >
            Tout {filters.vendor}
          </Link>
          {families.map((f) => (
            <Link
              key={f.type}
              to={family(f.type)}
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
              <Link to={`/app/catalogue/${p.numericId}`} className="catalogue-card">
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
                  <span>
                    {p.minPrice === p.maxPrice
                      ? money(p.minPrice)
                      : `dès ${money(p.minPrice)}`}{" "}
                    HTVA
                  </span>
                  {p.variants > 1 && <small>{p.variants} finitions</small>}
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
          <Link to={`?${more}`}>Voir la suite</Link>
        </p>
      )}
    </main>
  );
}
