import { useEffect, useRef, useState } from "react";
import {
  Form,
  Link,
  useFetcher,
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
  const { items, next, facets, families, filters, openQuote, demo, error } =
    useLoaderData<typeof loader>();
  // Ajout rapide au devis ouvert (dernière pièce), puis « Annuler ».
  const adder = useFetcher<{ ok?: string; error?: string; quote?: number; line?: string }>();
  const undoer = useFetcher<{ ok?: string; error?: string }>();
  const [added, setAdded] = useState<{ title: string; product: string } | null>(null);
  const lastRoom = openQuote?.sections.at(-1)?.title || "";
  const quickAdd = (p: { id: string; numericId: string; title: string }) => {
    if (!openQuote) return;
    setAdded({ title: p.title, product: p.numericId });
    adder.submit(
      { variant: p.id, qty: "1", quote: String(openQuote.id), placement: "end" },
      { method: "post", action: `/app/catalogue/${p.numericId}` },
    );
  };
  const undo = () => {
    if (!added || !adder.data?.line || !openQuote) return;
    undoer.submit(
      { intent: "undo", quote: String(openQuote.id), line: adder.data.line },
      { method: "post", action: `/app/catalogue/${added.product}` },
    );
  };
  useEffect(() => {
    if (undoer.data?.ok) setAdded(null);
  }, [undoer.data]);
  useEffect(() => {
    if (!added || adder.state !== "idle" || !adder.data?.ok) return;
    const t = setTimeout(() => setAdded(null), 8000);
    return () => clearTimeout(t);
  }, [added, adder.state, adder.data]);
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
  // Les familles des marques choisies, sinon toutes ; repliées au-delà de huit.
  const familyList = families.length
    ? families
    : facets.types.map((type) => ({ type, count: 0 }));
  const [allFamilies, setAllFamilies] = useState(false);
  const selected = familyList.filter((f) => f.type === filters.type);
  const shownFamilies = allFamilies
    ? familyList
    : [...familyList.slice(0, 8), ...selected.filter((f) => familyList.indexOf(f) >= 8)];
  const hiddenFamilies = familyList.length - shownFamilies.length;
  const brandLabel = filters.vendors.length
    ? filters.vendors.length === 1
      ? filters.vendors[0]
      : `${filters.vendors.length} marques`
    : "Toutes les marques";
  return (
    <main className="workspace catalogue">
      <header className="catalogue-head">
        <h1>Catalogue</h1>
        <p>Prix publics HTVA</p>
        {openQuote && (
          <Link to={`/app/quotes/${openQuote.id}`} className="catalogue-open-quote">
            <small>Devis ouvert</small>
            <strong>{openQuote.title}</strong>
            <span>{money(openQuote.total)}</span>
          </Link>
        )}
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
                    (form.elements.namedItem("famille") as HTMLInputElement).value = "";
                    apply(form);
                  }}
                />
                {v}
              </label>
            ))}
          </div>
        </details>
        <input type="hidden" name="famille" defaultValue={filters.type} key={filters.vendors.join("|") + filters.type} />
        {(filters.q || filters.vendors.length > 0 || filters.type) && (
          <Link to="/app/catalogue" reloadDocument className="catalogue-reset">
            Tout effacer
          </Link>
        )}
      </Form>
      {familyList.length > 1 && (
        <nav className="family-chips" aria-label="Familles">
          <Link
            to={link({ famille: "" })}
            className={filters.type ? "" : "active"}
            aria-current={filters.type ? undefined : "true"}
          >
            Toutes les familles
          </Link>
          {shownFamilies.map((f) => (
            <Link
              key={f.type}
              to={link({ famille: f.type })}
              className={filters.type === f.type ? "active" : ""}
              aria-current={filters.type === f.type ? "true" : undefined}
            >
              {f.type} {f.count > 0 && <span>{f.count}</span>}
            </Link>
          ))}
          {hiddenFamilies > 0 && (
            <button type="button" className="chip-more" onClick={() => setAllFamilies(true)}>
              + {hiddenFamilies} familles
            </button>
          )}
        </nav>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {items.length ? (
        <ul className="catalogue-grid" aria-busy={busy}>
          {items.map((p) => (
            <li key={p.id} className="catalogue-item">
              {openQuote && (
                <button
                  type="button"
                  className="catalogue-add"
                  aria-label={`Ajouter ${p.title} au devis ${openQuote.title}`}
                  title={lastRoom ? `Ajouter à ${lastRoom}` : "Ajouter au devis"}
                  disabled={adder.state !== "idle"}
                  onClick={() => quickAdd(p)}
                >
                  <span aria-hidden="true">+</span>
                </button>
              )}
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
                    <span className="catalogue-nophoto">
                      {p.vendor}
                      <small>Photo à venir</small>
                    </span>
                  )}
                </div>
                <div className="catalogue-meta">
                  <small>{p.vendor}</small>
                  <strong title={p.title}>{p.title}</strong>
                  <span className="catalogue-row">
                    <span className="catalogue-finish">{p.variantTitle}</span>
                    <span className="catalogue-price">{money(p.minPrice)}</span>
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        !error && (
          <div className="empty-state">
            <h2>Aucun produit trouvé</h2>
            <p>Retirez un filtre ou cherchez un autre mot.</p>
            {(filters.q || filters.vendors.length > 0 || filters.type) && (
              <Link to="/app/catalogue" reloadDocument>
                Voir tout le catalogue
              </Link>
            )}
          </div>
        )
      )}
      {added && (
        <div className="catalogue-toast" role="status">
          {adder.state !== "idle" ? (
            <span>Ajout de {added.title}…</span>
          ) : adder.data?.error ? (
            <span>{adder.data.error}</span>
          ) : undoer.state !== "idle" ? (
            <span>Annulation…</span>
          ) : (
            <>
              <span>
                {added.title} ajouté{lastRoom ? ` à ${lastRoom}` : ""}
              </span>
              <button type="button" className="text-button" onClick={undo}>
                Annuler
              </button>
              {openQuote && (
                <Link to={`/app/quotes/${openQuote.id}`}>Voir le devis</Link>
              )}
            </>
          )}
          <button
            type="button"
            className="catalogue-toast-close"
            aria-label="Fermer"
            onClick={() => setAdded(null)}
          >
            ×
          </button>
        </div>
      )}
      {next && (
        <p className="catalogue-more">
          <Link to={link({ apres: next })} className="catalogue-next">Voir les produits suivants</Link>
        </p>
      )}
    </main>
  );
}
