import { useEffect, useRef, useState } from "react";
import { money } from "../../domain/quote";
import { sized } from "./image";
import { FinishPicker } from "./FinishPicker";

/** Ce qu'il faut pour choisir la finition d'une carte du catalogue. */
export type FinishRequest = {
  numericId: string;
  title: string;
  /** Variante proposée d'abord. */
  variantId?: string;
  /** Variantes déjà proposées pour ce produit du devis (identifiant ou désignation). */
  taken?: string[];
  /** Texte du bouton, « Ajouter à Salon » par exemple. */
  action?: string;
};

type Loaded = {
  title: string;
  vendor: string;
  image: string;
  imageAlt: string;
  options: { name: string; values: string[] }[];
  variants: {
    id: string;
    title: string;
    price: number;
    image: string;
    options: { name: string; value: string }[];
  }[];
};

let show: ((r: FinishRequest, done: (id: string | null) => void) => void) | null =
  null;

/** Demande la finition d'un produit. Rend l'identifiant de la variante choisie,
 * ou null si on referme la fenêtre. Sans fenêtre montée, garde la variante proposée. */
export function chooseFinish(r: FinishRequest): Promise<string | null> {
  return new Promise((resolve) =>
    show ? show(r, resolve) : resolve(r.variantId || null),
  );
}

/** La fenêtre de choix de finition, montée une fois dans la mise en page. */
export function FinishChooserHost() {
  const [req, setReq] = useState<FinishRequest | null>(null);
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [value, setValue] = useState("");
  const done = useRef<((id: string | null) => void) | null>(null);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    show = (r, resolve) => {
      done.current?.(null);
      done.current = resolve;
      setReq(r);
      setData(null);
      setError("");
      setValue(r.variantId || "");
    };
    return () => {
      show = null;
    };
  }, []);
  useEffect(() => {
    if (!req) return;
    ref.current?.showModal();
    const ctrl = new AbortController();
    const url = new URL("/app/catalog", location.origin);
    url.searchParams.set("kind", "product");
    url.searchParams.set("produit", req.numericId);
    fetch(url, { signal: ctrl.signal })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error || "");
        const loaded = d as Loaded;
        const taken = new Set(req.taken || []);
        const free = loaded.variants.find((v) => !isTaken(v, loaded.title, taken));
        setValue((current) =>
          loaded.variants.some((v) => v.id === current) &&
          !isTaken(loaded.variants.find((v) => v.id === current)!, loaded.title, taken)
            ? current
            : free?.id || loaded.variants[0]?.id || "",
        );
        setData(loaded);
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        setError(
          (e instanceof Error && e.message) ||
            "Les finitions n'ont pas pu être chargées. Réessayez.",
        );
      });
    return () => ctrl.abort();
  }, [req]);

  const finish = (id: string | null) => {
    done.current?.(id);
    done.current = null;
    ref.current?.close();
    setReq(null);
  };
  const taken = new Set(req?.taken || []);
  const variant = data?.variants.find((v) => v.id === value);
  const used = !!variant && !!data && isTaken(variant, data.title, taken);
  const image = variant?.image || data?.image || "";

  return (
    <dialog
      ref={ref}
      className="finish-dialog"
      aria-label={req ? `Finition de ${req.title}` : "Finition"}
      onCancel={(e) => {
        e.preventDefault();
        finish(null);
      }}
    >
      {req && (
        <>
          <header className="modal-head">
            <h2>
              <small>{data?.vendor || "Finition"}</small>
              {req.title}
            </h2>
            <button type="button" onClick={() => finish(null)}>
              Fermer
            </button>
          </header>
          {error ? (
            <p role="alert" className="error">
              {error}
            </p>
          ) : !data ? (
            <p className="muted" role="status">
              Chargement des finitions…
            </p>
          ) : (
            <div className="finish-body">
              <div className="finish-photo">
                {image && <img src={sized(image, 400)} alt={data.imageAlt} />}
              </div>
              <div className="finish-choice">
                <FinishPicker
                  options={data.options}
                  variants={data.variants}
                  value={value}
                  onChange={setValue}
                  taken={(id) => {
                    const v = data.variants.find((x) => x.id === id);
                    return !!v && isTaken(v, data.title, taken);
                  }}
                />
              </div>
            </div>
          )}
          <footer className="modal-actions">
            <span>
              {used ? (
                <span className="error">Déjà proposée dans le devis</span>
              ) : (
                variant && (
                  <>
                    <strong>{money(variant.price)}</strong> HTVA
                  </>
                )
              )}
            </span>
            <button
              type="button"
              className="primary"
              disabled={!variant || used}
              onClick={() => finish(value)}
            >
              {req.action || "Ajouter au devis"}
            </button>
          </footer>
        </>
      )}
    </dialog>
  );
}

const isTaken = (
  v: { id: string; title: string },
  title: string,
  taken: Set<string>,
) => taken.has(v.id) || taken.has(`${title} - ${v.title}`);
