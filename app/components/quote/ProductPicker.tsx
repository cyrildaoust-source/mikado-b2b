import { useEffect, useRef, useState } from "react";
import { money, type Line, type QuoteState } from "../../domain/quote";
import { Modal } from "./Modal";
import { sized } from "../catalog/image";
export type Customer = {
  id: string | null;
  name: string;
  email: string;
  address: QuoteState["shipping"];
};
export function ProductPicker({
  kind,
  onClose,
  onSelect,
}: {
  kind: "products" | "customers";
  onClose: () => void;
  onSelect: (items: (Line | Customer)[]) => void;
}) {
  const [search, setSearch] = useState(""),
    [items, setItems] = useState<(Line | Customer)[]>([]),
    [selected, setSelected] = useState<Line[]>([]),
    [next, setNext] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const seq = useRef(0);
  async function lookup(after?: string, q = search) {
    const n = ++seq.current;
    setBusy(true);
    setError("");
    try {
      const url = new URL("/app/catalog", location.origin);
      url.searchParams.set("kind", kind);
      url.searchParams.set("q", q);
      if (after) url.searchParams.set("after", after);
      const r = await fetch(url);
      if (!r.ok) throw Error();
      const d = await r.json();
      if (n !== seq.current) return;
      setItems((old) => (after ? [...old, ...d.items] : d.items));
      setNext(d.next);
    } catch {
      setError("Recherche indisponible. Réessayez.");
    } finally {
      if (n === seq.current) setBusy(false);
    }
  }
  useEffect(() => {
    void lookup();
    return () => {
      seq.current++;
      clearTimeout(timer.current);
    };
  }, []);
  // La recherche part pendant la frappe : pas de bouton à viser.
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const type = (value: string) => {
    setSearch(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void lookup(undefined, value), 300);
  };
  const isProducts = kind === "products";
  return (
    <Modal
      title={isProducts ? "Choisir des produits" : "Choisir un client"}
      onClose={onClose}
    >
      <form
        className="picker-search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          clearTimeout(timer.current);
          void lookup();
        }}
      >
        <input
          type="search"
          aria-label={isProducts ? "Rechercher un produit" : "Rechercher un client"}
          placeholder={
            isProducts ? "Nom du produit ou référence" : "Nom, société ou e-mail"
          }
          value={search}
          autoFocus
          onChange={(e) => type(e.target.value)}
        />
      </form>
      <p className="picker-status" role="status">
        {busy
          ? "Recherche…"
          : error
            ? ""
            : !items.length
              ? search.trim()
                ? `Aucun ${isProducts ? "produit" : "client"} trouvé pour « ${search.trim()} ».`
                : `Aucun ${isProducts ? "produit" : "client"} pour le moment.`
              : ""}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {items.length > 0 && (
        <ul className="picker-list" aria-busy={busy}>
          {items.map((i, n) =>
            "price" in i ? (
              <li key={i.id}>
                <label className="picker-item">
                  <input
                    type="checkbox"
                    checked={selected.some((x) => x.id === i.id)}
                    onChange={(e) =>
                      setSelected((x) =>
                        e.target.checked
                          ? [...x, i]
                          : x.filter((y) => y.id !== i.id),
                      )
                    }
                  />
                  {i.image ? (
                    <img className="picker-thumb" src={sized(i.image, 96)} alt="" />
                  ) : (
                    <span className="picker-thumb" aria-hidden="true" />
                  )}
                  <span className="picker-text">
                    <strong>{i.name}</strong>
                    {i.sku && <small>{i.sku}</small>}
                  </span>
                  <span className="picker-price">{money(i.price)}</span>
                </label>
              </li>
            ) : (
              <li key={i.id || n}>
                <button
                  type="button"
                  className="picker-item"
                  onClick={() => onSelect([i])}
                >
                  <span className="picker-initials" aria-hidden="true">
                    {initials(i.address.company || i.name)}
                  </span>
                  <span className="picker-text">
                    <strong>{i.address.company || i.name || i.email}</strong>
                    <small>
                      {[
                        i.address.company && i.name !== i.address.company ? i.name : "",
                        i.email,
                        i.address.city,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </span>
                  <span className="picker-go" aria-hidden="true">
                    Choisir
                  </span>
                </button>
              </li>
            ),
          )}
        </ul>
      )}
      {next && (
        <button
          type="button"
          className="text-button picker-more"
          disabled={busy}
          onClick={() => void lookup(next)}
        >
          Afficher plus
        </button>
      )}
      {isProducts && (
        <footer className="modal-actions">
          <span>
            {selected.length
              ? `${selected.length} produit${selected.length > 1 ? "s" : ""} choisi${selected.length > 1 ? "s" : ""}`
              : "Cochez les produits à ajouter"}
          </span>
          <button
            className="primary"
            disabled={!selected.length || busy}
            onClick={() => onSelect(selected)}
          >
            Ajouter
          </button>
        </footer>
      )}
    </Modal>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || "")
    .join("") || "?";

export async function nativeProducts(): Promise<Line[] | null> {
  const selection = await window.shopify.resourcePicker({
    type: "product",
    multiple: true,
    action: "add",
  });
  if (!selection) return null;
  const ids = [...new Set(selection.flatMap((product) =>
    product.variants.map((variant) => variant.id),
  ))];
  if (!ids.length) return null;
  if (ids.length > 100)
    throw Error("Ajoutez au maximum 100 variantes à la fois.");
  const r = await fetch(
    "/app/catalog?kind=variants&ids=" + encodeURIComponent(ids.join(",")),
  );
  const d = await r.json();
  if (!r.ok) throw Error(d.error || "Catalogue indisponible");
  return d.items;
}
