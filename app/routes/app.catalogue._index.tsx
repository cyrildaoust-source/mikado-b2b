import { useEffect, useMemo, useRef, useState } from "react";
import {
  Form,
  Link,
  useFetcher,
  useLoaderData,
  useLocation,
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
      type: "",
      types: [...new Set(u.searchParams.getAll("famille"))]
        .map((t) => t.slice(0, 150))
        .filter(Boolean)
        .slice(0, 30),
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
  const [added, setAdded] = useState<{ title: string; product: string; where: string } | null>(null);
  const lastRoom = openQuote?.sections.at(-1)?.title || "";
  type Card = { id: string; numericId: string; title: string };
  const quickAdd = (p: Card, placement = "end", where = lastRoom ? `à ${lastRoom}` : "") => {
    if (!openQuote) return;
    setAdded({ title: p.title, product: p.numericId, where });
    adder.submit(
      { variant: p.id, qty: "1", quote: String(openQuote.id), placement },
      { method: "post", action: `/app/catalogue/${p.numericId}` },
    );
  };
  // Glisser une carte vers le devis ouvert : un panneau de dépôt apparaît
  // pendant le geste, avec les pièces et les produits du devis.
  const [dragCard, setDragCard] = useState<Card | null>(null);
  const [dropKey, setDropKey] = useState("");
  const dragRef = useRef<Card | null>(null);
  const dropZone = (key: string, placement: string, where: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
      if (dropKey !== key) setDropKey(key);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropKey("");
    },
    onDrop: (e: React.DragEvent) => {
      const card = dragRef.current;
      if (!card) return;
      e.preventDefault();
      e.stopPropagation();
      quickAdd(card, placement, where);
      dragRef.current = null;
      setDragCard(null);
      setDropKey("");
    },
  });
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
  const apply = (form: HTMLFormElement, delay = 0) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => submit(form, { replace: true }), delay);
  };
  const query = (apres?: string) => {
    const p = new URLSearchParams();
    if (filters.q) p.set("q", filters.q);
    filters.vendors.forEach((v) => p.append("marque", v));
    filters.types.forEach((t) => p.append("famille", t));
    if (apres) p.set("apres", apres);
    return `?${p}`;
  };
  const busy = useNavigation().state === "loading";
  const filtered = !!(filters.q || filters.vendors.length || filters.types.length);
  // Familles des marques choisies (avec leur nombre), sinon toutes.
  const familyList = families.length
    ? families
    : facets.types.map((type) => ({ type, count: 0 }));

  // Défilement continu : la page suivante se charge en approchant du bas.
  const search = useLocation().search;
  const more = useFetcher<typeof loader>();
  const [extra, setExtra] = useState<{ items: typeof items; next: string | null }>({
    items: [],
    next: null,
  });
  useEffect(() => setExtra({ items: [], next: null }), [search]);
  useEffect(() => {
    const d = more.data;
    if (!d || more.state !== "idle") return;
    setExtra((e) => ({ items: [...e.items, ...d.items], next: d.next }));
  }, [more.data, more.state]);
  const cursor = extra.items.length ? extra.next : next;
  const loadMore = () => {
    if (cursor && more.state === "idle")
      more.load(`/app/catalogue${query(cursor)}`);
  };
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !cursor) return;
    const io = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && loadMore(),
      { rootMargin: "1200px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  });
  // Rangées complètes : tant qu'il reste des produits, la dernière rangée
  // incomplète attend la page suivante.
  const grid = useRef<HTMLUListElement>(null);
  const [cols, setCols] = useState(1);
  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    const measure = () =>
      setCols(
        getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length || 1,
      );
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [items.length > 0]);
  const shown = useMemo(() => {
    const all = [...items, ...extra.items];
    if (!cursor || all.length < cols) return all;
    return all.slice(0, all.length - (all.length % cols));
  }, [items, extra.items, cursor, cols]);
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
        <Picker
          name="marque"
          all="Toutes les marques"
          plural="marques"
          options={facets.vendors.map((v) => ({ value: v, count: 0 }))}
          selected={filters.vendors}
          onChange={(form) => {
            // Les familles dépendent des marques : on repart de toutes.
            form
              .querySelectorAll<HTMLInputElement>('input[name="famille"]')
              .forEach((c) => (c.checked = false));
            apply(form);
          }}
        />
        {familyList.length > 1 && (
          <Picker
            name="famille"
            all="Toutes les familles"
            plural="familles"
            options={familyList.map((f) => ({ value: f.type, count: f.count }))}
            selected={filters.types}
            onChange={(form) => apply(form)}
          />
        )}
        {filtered && (
          <Link to="/app/catalogue" reloadDocument className="catalogue-reset">
            Tout effacer
          </Link>
        )}
      </Form>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {items.length ? (
        <ul className="catalogue-grid" aria-busy={busy} ref={grid}>
          {shown.map((p) => (
            <li
              key={p.id}
              className={`catalogue-item${dragCard?.id === p.id ? " is-dragging" : ""}`}
              onDragStart={(e) => {
                if (!openQuote) return;
                e.dataTransfer.effectAllowed = "copy";
                dragRef.current = p;
                setDragCard(p);
              }}
              onDragEnd={() => {
                dragRef.current = null;
                setDragCard(null);
                setDropKey("");
              }}
            >
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
            {filtered && (
              <Link to="/app/catalogue" reloadDocument>
                Voir tout le catalogue
              </Link>
            )}
          </div>
        )
      )}
      {openQuote && (
        <aside
          className={`drop-panel${dragCard ? " open" : ""}`}
          aria-hidden={!dragCard}
        >
          <header>
            <small>Déposer dans {openQuote.title}</small>
            {dragCard && <strong>{dragCard.title}</strong>}
          </header>
          {openQuote.sections.map((section) => (
            <section
              key={section.id}
              className={dropKey === `s:${section.id}` ? "over" : ""}
              {...dropZone(`s:${section.id}`, `section:${section.id}`, `à ${section.title}`)}
            >
              <h3>{section.title}</h3>
              <p className="drop-hint">Nouveau produit dans cette pièce</p>
              {section.groups.map((g) => (
                <div
                  key={g.id}
                  className={`drop-group${dropKey === `g:${g.id}` ? " over" : ""}`}
                  {...dropZone(`g:${g.id}`, `alternative:${g.id}`, `en alternative à ${g.name}`)}
                >
                  {g.image ? <img src={sized(g.image, 96)} alt="" /> : <span className="thumb" />}
                  <span>
                    {g.name}
                    <small>En alternative</small>
                  </span>
                </div>
              ))}
            </section>
          ))}
          {openQuote.sections.length === 0 && (
            <section
              className={dropKey === "end" ? "over" : ""}
              {...dropZone("end", "end", "au devis")}
            >
              <h3>Devis vide</h3>
              <p className="drop-hint">Déposer ici pour commencer</p>
            </section>
          )}
          <section
            className={`drop-option${dropKey === "option" ? " over" : ""}`}
            {...dropZone("option", "option", "en option")}
          >
            <h3>En option</h3>
            <p className="drop-hint">Hors total</p>
          </section>
        </aside>
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
                {added.title} ajouté{added.where ? ` ${added.where}` : ""}
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
      {cursor && (
        <div className="catalogue-more" ref={sentinel}>
          <button type="button" onClick={loadMore} disabled={more.state !== "idle"}>
            {more.state !== "idle" ? "Chargement…" : "Afficher plus de produits"}
          </button>
        </div>
      )}
    </main>
  );
}

/** Menu déroulant à choix multiples, avec recherche au-delà de huit choix.
 * Chaque case s'applique tout de suite ; le menu se ferme au clic dehors,
 * avec Échap ou avec « Terminé ». */
function Picker({
  name,
  all,
  plural,
  options,
  selected,
  onChange,
}: {
  name: string;
  all: string;
  plural: string;
  options: { value: string; count: number }[];
  selected: string[];
  onChange: (form: HTMLFormElement) => void;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [find, setFind] = useState("");
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        ref.current.open = false;
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && ref.current?.open) {
        ref.current.open = false;
        ref.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, []);
  const label = selected.length
    ? selected.length === 1
      ? selected[0]
      : `${selected.length} ${plural}`
    : all;
  const f = find.trim().toLowerCase();
  return (
    <details className="brand-picker" ref={ref}>
      <summary>
        <span>{label}</span>
      </summary>
      <div className="brand-picker-list">
        {options.length > 8 && (
          <input
            type="search"
            className="picker-search"
            aria-label={`Chercher dans les ${plural}`}
            placeholder="Chercher…"
            value={find}
            onChange={(e) => setFind(e.target.value)}
            form=""
          />
        )}
        {options.map((o) => (
          <label key={o.value} hidden={!!f && !o.value.toLowerCase().includes(f)}>
            <input
              type="checkbox"
              name={name}
              value={o.value}
              defaultChecked={selected.includes(o.value)}
              onChange={(e) => onChange(e.currentTarget.form!)}
            />
            <span>{o.value}</span>
            {o.count > 0 && <small>{o.count}</small>}
          </label>
        ))}
        <div className="picker-foot">
          {selected.length > 0 && (
            <button
              type="button"
              className="text-button"
              onClick={(e) => {
                const form = (e.currentTarget as HTMLButtonElement).closest("form")!;
                ref.current
                  ?.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)
                  .forEach((c) => (c.checked = false));
                onChange(form);
              }}
            >
              Tout désélectionner
            </button>
          )}
          <button
            type="button"
            className="picker-done"
            onClick={() => ref.current && (ref.current.open = false)}
          >
            Terminé
          </button>
        </div>
      </div>
    </details>
  );
}
