import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { money } from "../../domain/quote";
import { sized } from "../catalog/image";
import { Picker } from "../catalog/Picker";

/** Une carte du catalogue, telle que l'éditeur la reçoit pour l'ajouter. */
export type CatalogueCard = {
  id: string; // variante (gid)
  numericId: string; // produit
  title: string;
};

/** Carte en cours de glisser : lue par les zones de dépôt de l'éditeur.
 * Une simple référence suffit, le geste ne dure que le temps du glisser. */
export const catalogueDrag: { current: CatalogueCard | null } = {
  current: null,
};

/** Demande d'ajout d'une carte (bouton +) : l'éditeur l'ajoute à la
 * dernière pièce du devis. */
export const CATALOGUE_ADD = "mikado:catalogue-add";

type Page = {
  items: (CatalogueCard & {
    vendor: string;
    variantTitle: string;
    variantNumericId: string;
    minPrice: number;
    image: string | null;
    imageAlt: string;
  })[];
  next: string | null;
  facets: { vendors: string[]; types: string[] };
  families: { type: string; count: number }[];
  error: string | null;
};

/** Le catalogue à gauche du devis. Il vit hors de l'éditeur, qui se
 * recharge à chaque enregistrement : la recherche et le défilement
 * restent en place. */
export function CatalogueBrowser({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const first = useFetcher<Page>();
  const more = useFetcher<Page>();
  const [query, setQuery] = useState(() => new URLSearchParams());
  const [extra, setExtra] = useState<{ items: Page["items"]; next: string | null }>({
    items: [],
    next: null,
  });
  const [dragId, setDragId] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const pane = useRef<HTMLElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  const url = (q: URLSearchParams, after?: string) => {
    const p = new URLSearchParams(q);
    p.set("index", "");
    if (after) p.set("apres", after);
    return `/app/catalogue?${p}`;
  };
  useEffect(() => {
    first.load(url(query));
    setExtra({ items: [], next: null });
    pane.current?.querySelector(".pane-scroll")?.scrollTo({ top: 0 });
  }, [query]);
  useEffect(() => {
    const d = more.data;
    if (!d || more.state !== "idle") return;
    setExtra((e) => ({ items: [...e.items, ...d.items], next: d.next }));
  }, [more.data, more.state]);

  const data = first.data;
  const items = [...(data?.items || []), ...extra.items];
  const cursor = extra.items.length ? extra.next : data?.next || null;
  const loadMore = () => {
    if (cursor && more.state === "idle") more.load(url(query, cursor));
  };
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !cursor) return;
    const io = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && loadMore(),
      { root: pane.current?.querySelector(".pane-scroll"), rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  });

  const apply = (form: HTMLFormElement, delay = 0) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const p = new URLSearchParams();
      const f = new FormData(form);
      const q = String(f.get("q") || "").trim();
      if (q) p.set("q", q);
      f.getAll("marque").forEach((v) => p.append("marque", String(v)));
      f.getAll("famille").forEach((v) => p.append("famille", String(v)));
      setQuery(p);
    }, delay);
  };
  const vendors = query.getAll("marque");
  const types = query.getAll("famille");
  const families = data?.families.length
    ? data.families
    : (data?.facets.types || []).map((type) => ({ type, count: 0 }));
  const filtered = !!(query.get("q") || vendors.length || types.length);
  const busy = first.state !== "idle";

  return (
    <aside
      ref={pane}
      className={`catalogue-pane${open ? " open" : ""}`}
      aria-label="Catalogue"
    >
      <header className="pane-head">
        <h2>Catalogue</h2>
        <small>Glissez un produit dans une pièce, ou utilisez +</small>
        <button type="button" className="text-button pane-close" onClick={onClose}>
          Fermer
        </button>
      </header>
      <form
        className="catalogue-filters"
        onSubmit={(e) => {
          e.preventDefault();
          apply(e.currentTarget);
        }}
      >
        <input
          name="q"
          type="search"
          aria-label="Rechercher dans le catalogue"
          placeholder="Produit, designer, référence…"
          onChange={(e) => apply(e.currentTarget.form!, 350)}
        />
        <Picker
          key={`m-${vendors.join("|")}`}
          name="marque"
          all="Toutes les marques"
          plural="marques"
          options={(data?.facets.vendors || []).map((v) => ({ value: v, count: 0 }))}
          selected={vendors}
          onChange={(form) => {
            form
              .querySelectorAll<HTMLInputElement>('input[name="famille"]')
              .forEach((c) => (c.checked = false));
            apply(form);
          }}
        />
        {families.length > 1 && (
          <Picker
            key={`f-${vendors.join("|")}`}
            name="famille"
            all="Toutes les familles"
            plural="familles"
            options={families.map((f) => ({ value: f.type, count: f.count }))}
            selected={types}
            onChange={(form) => apply(form)}
          />
        )}
        {filtered && (
          <button
            type="reset"
            className="text-button"
            onClick={() => setQuery(new URLSearchParams())}
          >
            Tout effacer
          </button>
        )}
      </form>
      <div className="pane-scroll">
        {data?.error && (
          <p role="alert" className="error">
            {data.error}
          </p>
        )}
        {items.length > 0 && (
          <ul className="catalogue-grid" aria-busy={busy}>
            {items.map((p) => (
              <li
                key={p.id}
                className={`catalogue-item${dragId === p.id ? " is-dragging" : ""}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "copy";
                  e.dataTransfer.setData("text/plain", p.title);
                  catalogueDrag.current = p;
                  setDragId(p.id);
                  document.documentElement.classList.add("is-dragging-card");
                }}
                onDragEnd={() => {
                  catalogueDrag.current = null;
                  setDragId("");
                  document.documentElement.classList.remove("is-dragging-card");
                }}
              >
                <button
                  type="button"
                  className="catalogue-add"
                  aria-label={`Ajouter ${p.title} au devis`}
                  title="Ajouter à la dernière pièce"
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent<CatalogueCard>(CATALOGUE_ADD, {
                        detail: { id: p.id, numericId: p.numericId, title: p.title },
                      }),
                    )
                  }
                >
                  <span aria-hidden="true">+</span>
                </button>
                <div className="catalogue-card">
                  <div className="catalogue-photo">
                    {p.image ? (
                      <img
                        src={sized(p.image, 400)}
                        alt={p.imageAlt}
                        loading="lazy"
                        draggable={false}
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
                </div>
              </li>
            ))}
          </ul>
        )}
        {data && !items.length && !data.error && (
          <div className="empty-state">
            <h3>Aucun produit trouvé</h3>
            <p>Retirez un filtre ou cherchez un autre mot.</p>
          </div>
        )}
        {cursor && (
          <div className="catalogue-more" ref={sentinel}>
            <button type="button" onClick={loadMore} disabled={more.state !== "idle"}>
              {more.state !== "idle" ? "Chargement…" : "Afficher plus de produits"}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
