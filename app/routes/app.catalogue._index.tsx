import { useEffect, useMemo, useRef, useState } from "react";
import {
  Form,
  Link,
  data,
  useFetcher,
  useLoaderData,
  useLocation,
  useNavigation,
  useSubmit,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type ShouldRevalidateFunctionArgs,
} from "react-router";
import { context, ownerScope } from "../services/context.server";
import {
  currentQuoteId,
  quotePanel,
  rememberQuote,
} from "../services/current-quote.server";
import { openQuotes } from "../services/catalog-quote.server";
import { readForm } from "../services/form.server";
import {
  brandFamilies,
  catalogFacets,
  listCatalog,
} from "../services/catalog.server";
import { money } from "../domain/quote";
import { sized } from "../components/catalog/image";
import { Picker } from "../components/catalog/Picker";
import { chooseFinish } from "../components/catalog/FinishChooser";
import { ProPrice } from "../components/ProPrice";

export const meta = () => [{ title: "Catalogue · Mikado Deco Pro" }];

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
    // Page suivante du défilement : seule la liste sert, le reste est déjà affiché.
    const page = !!filters.after;
    const [list, facets, families, quotes, openQuote] = await Promise.all([
      listCatalog(c.admin, filters),
      page ? { vendors: [], types: [] } : catalogFacets(c.admin),
      page ? [] : brandFamilies(c.admin, filters.vendors).catch(() => []),
      page ? [] : openQuotes(c.shop, ownerScope(c)).catch(() => []),
      page
        ? null
        : currentQuoteId(request)
            .then((id) => quotePanel(c.shop, id, ownerScope(c)))
            .catch(() => null),
    ]);
    return {
      ...list,
      facets,
      families,
      filters,
      openQuote,
      quotes: quotes.slice(0, 8),
      demo: c.demo,
      error: null,
    };
  } catch {
    return {
      items: [],
      next: null,
      facets: { vendors: [], types: [] },
      families: [] as { type: string; count: number }[],
      filters,
      openQuote: null,
      quotes: [] as { id: number; title: string; customer: string; number: string }[],
      demo: c.demo,
      error: "Catalogue indisponible pour le moment. Réessayez dans un instant.",
    };
  }
}

// Choisir le devis sur lequel on travaille depuis le catalogue (ou le fermer).
export async function action({ request }: ActionFunctionArgs) {
  const c = await context(request);
  const form = await readForm(request);
  if (form.get("intent") === "close")
    return data({ ok: true }, { headers: { "Set-Cookie": await rememberQuote(null) } });
  const id = Number(form.get("quote"));
  const panel = Number.isSafeInteger(id)
    ? await quotePanel(c.shop, id, ownerScope(c))
    : null;
  if (!panel) return { ok: false, error: "Ce devis n'est plus modifiable." };
  return data({ ok: true }, { headers: { "Set-Cookie": await rememberQuote(panel.id) } });
}

/**
 * La liste ne dépend que de son adresse. Un enregistrement du devis (toutes les
 * 700 ms pendant la saisie) ne la recharge pas : elle reprenait sinon ses trois
 * appels Shopify, pour chaque page déjà chargée du catalogue ouvert à côté du
 * devis. Après un ajout depuis le catalogue lui-même, seule la page affichée se
 * recharge, pour le devis ouvert ; les pages suivantes restent telles quelles.
 */
export function shouldRevalidate({
  currentUrl,
  formMethod,
  formAction,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  // Filtres, recherche et navigation (GET) : rechargement normal.
  if (!formMethod || formMethod.toUpperCase() === "GET")
    return defaultShouldRevalidate;
  if (!formAction?.startsWith("/app/catalogue")) return false;
  const fetcher =
    currentUrl.searchParams.has("apres") || currentUrl.searchParams.has("index");
  return !fetcher && defaultShouldRevalidate;
}
export default function Catalogue() {
  const { items, next, facets, families, filters, openQuote, quotes, demo, error } =
    useLoaderData<typeof loader>();
  const chooser = useFetcher<{ ok: boolean; error?: string }>();
  const chooseQuote = (id: number | null) =>
    chooser.submit(
      id === null ? { intent: "close" } : { intent: "use", quote: String(id) },
      { method: "post", action: "/app/catalogue?index" },
    );
  const otherQuotes = quotes.filter((q) => q.id !== openQuote?.id);
  // Ajout rapide au devis ouvert (dernière pièce), puis « Annuler ».
  const adder = useFetcher<{ ok?: string; error?: string; quote?: number; line?: string }>();
  const undoer = useFetcher<{ ok?: string; error?: string }>();
  const [added, setAdded] = useState<{ title: string; product: string; where: string } | null>(null);
  const lastRoom = openQuote?.sections.at(-1)?.title || "";
  type Card = { id: string; numericId: string; title: string; variants: number };
  const quickAdd = async (p: Card, placement = "end", where = lastRoom ? `à ${lastRoom}` : "") => {
    if (!openQuote) return;
    // Plusieurs finitions : on choisit avant d'ajouter, comme sur la fiche.
    const variant =
      p.variants > 1
        ? await chooseFinish({
            numericId: p.numericId,
            title: p.title,
            variantId: p.id,
            action: where ? `Ajouter ${where}` : "Ajouter au devis",
          })
        : p.id;
    if (!variant) return;
    setAdded({ title: p.title, product: p.numericId, where });
    adder.submit(
      { variant, qty: "1", quote: String(openQuote.id), placement },
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
      void quickAdd(card, placement, where);
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
    setExtra((e) => {
      const known = new Set([...items, ...e.items].map((i) => i.id));
      return {
        items: [...e.items, ...d.items.filter((i) => !known.has(i.id))],
        next: d.next,
      };
    });
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
        <ul
          className={`catalogue-grid${openQuote ? " can-drag" : ""}`}
          aria-busy={busy}
          ref={grid}
        >
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
                  onClick={() => void quickAdd(p)}
                >
                  <span aria-hidden="true">+</span>
                </button>
              )}
              <Link
                to={`/app/catalogue/${p.numericId}${p.variants > 1 ? "" : `?variante=${p.variantNumericId}`}`}
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
                    <span className="catalogue-finish">
                      {p.variants > 1 ? `${p.variants} finitions` : p.variantTitle}
                    </span>
                    <span className="catalogue-price">
                      {p.maxPrice > p.minPrice ? `dès ${money(p.minPrice)}` : money(p.minPrice)}
                      <ProPrice cents={p.minPrice} from={p.maxPrice > p.minPrice} />
                    </span>
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
              <Link to="/app/catalogue" reloadDocument className="button">
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
      {(openQuote || quotes.length > 0) && (
        <div
          className={`catalogue-dock${dragCard ? " dragging" : ""}`}
          role="region"
          aria-label="Devis en cours"
        >
          {openQuote ? (
            <span className="dock-quote">
              <small>Devis en cours</small>
              <strong title={openQuote.title}>{openQuote.title}</strong>
              <span className="dock-quote-total">{money(openQuote.total)} HTVA</span>
            </span>
          ) : (
            <span className="dock-quote">
              <small>Aucun devis ouvert</small>
              <strong>Ajouter des produits à un devis</strong>
            </span>
          )}
          <span className="dock-status" role="status">
            {added ? (
              adder.state !== "idle" ? (
                <>Ajout de {added.title}…</>
              ) : adder.data?.error ? (
                <span className="dock-error">{adder.data.error}</span>
              ) : undoer.state !== "idle" ? (
                <>Annulation…</>
              ) : (
                <>
                  <span className="dock-added">
                    {added.title} ajouté{added.where ? ` ${added.where}` : ""}
                  </span>
                  <button type="button" className="text-button" onClick={undo}>
                    Annuler
                  </button>
                </>
              )
            ) : chooser.data?.error ? (
              <span className="dock-error">{chooser.data.error}</span>
            ) : openQuote ? (
              <span className="dock-hint">
                Le bouton <b>+</b> d'une carte l'ajoute {lastRoom ? `à ${lastRoom}` : "au devis"}.
                <span className="hint-fine"> Glissez une carte pour choisir la pièce, une alternative ou une option.</span>
              </span>
            ) : (
              <span className="dock-hint">
                Choisissez le devis sur lequel vous travaillez pour y ajouter des produits en un geste.
              </span>
            )}
          </span>
          {openQuote && (
            <span className="dock-total">
              <small>Total HTVA</small>
              <strong>{money(openQuote.total)}</strong>
            </span>
          )}
          <span className="dock-actions">
            {(otherQuotes.length > 0 || openQuote) && (
              <details className="action-menu dock-menu">
                <summary>
                  {openQuote ? "Changer" : "Choisir un devis"}
                </summary>
                <div>
                  {otherQuotes.map((q) => (
                    <button
                      key={q.id}
                      type="button"
                      onClick={(e) => {
                        e.currentTarget.closest("details")!.open = false;
                        chooseQuote(q.id);
                      }}
                    >
                      <span>
                        {q.title}
                        {q.customer && <small>{q.customer}</small>}
                      </span>
                    </button>
                  ))}
                  {openQuote && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.currentTarget.closest("details")!.open = false;
                        chooseQuote(null);
                      }}
                    >
                      Ne plus ajouter à ce devis
                    </button>
                  )}
                </div>
              </details>
            )}
            {openQuote && (
              <Link to={`/app/quotes/${openQuote.id}`} className="button primary">
                Ouvrir<span className="dock-suffix"> le devis</span>
              </Link>
            )}
          </span>
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
