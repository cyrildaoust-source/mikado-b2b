import { useEffect, useRef, useState } from "react";
import { money, type Line, type QuoteState } from "../../domain/quote";
import { Modal } from "./Modal";
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
  async function lookup(after?: string) {
    const n = ++seq.current;
    setBusy(true);
    setError("");
    try {
      const url = new URL("/app/catalog", location.origin);
      url.searchParams.set("kind", kind);
      url.searchParams.set("q", search);
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
    };
  }, []);
  return (
    <Modal
      title={kind === "products" ? "Choisir des produits" : "Choisir un client"}
      onClose={onClose}
    >
      <form
        className="search"
        onSubmit={(e) => {
          e.preventDefault();
          void lookup();
        }}
      >
        <input
          aria-label="Rechercher"
          placeholder={
            kind === "products"
              ? "Nom du produit ou référence"
              : "Nom du client"
          }
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button disabled={busy}>Rechercher</button>
      </form>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {busy && <p role="status">Recherche…</p>}
      <div className="searchresults">
        {items.map((i, n) =>
          "price" in i ? (
            <label className="picker-row" key={i.id}>
              <input
                type="checkbox"
                checked={selected.some((s) => s.id === i.id)}
                onChange={(e) =>
                  setSelected((s) =>
                    e.target.checked
                      ? [...s, i]
                      : s.filter((x) => x.id !== i.id),
                  )
                }
              />
              <span>
                <strong>{i.name}</strong>
                <small>{i.sku}</small>
              </span>
              <span>{money(i.price)} HTVA</span>
            </label>
          ) : (
            <button key={i.id || n} onClick={() => onSelect([i])}>
              <span>
                {i.address.company || i.name}
                <small>
                  {i.name} · {i.email} · {i.address.city}
                </small>
              </span>
            </button>
          ),
        )}
        {!busy && !items.length && <p>Aucun résultat.</p>}
      </div>
      {next && (
        <button disabled={busy} onClick={() => void lookup(next)}>
          Charger la suite
        </button>
      )}
      {kind === "products" && (
        <footer className="modal-actions">
          <span>{selected.length} produit(s) sélectionné(s)</span>
          <button
            className="primary"
            disabled={!selected.length || busy}
            onClick={() => onSelect(selected)}
          >
            Ajouter la sélection
          </button>
        </footer>
      )}
    </Modal>
  );
}
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
