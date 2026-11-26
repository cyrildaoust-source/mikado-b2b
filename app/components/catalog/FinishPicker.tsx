import { useState } from "react";

type Variant = { id: string; options: { name: string; value: string }[] };

/** Choix de la finition par option Shopify (taille, couleur…), une rangée
 * par option. Une combinaison qui n'existe pas est grisée ; la choisir
 * change l'autre option. Une valeur prise ailleurs (`taken`) est barrée. */
export function FinishPicker({
  options,
  variants,
  value,
  onChange,
  taken,
}: {
  options: { name: string; values: string[] }[];
  variants: Variant[];
  value: string;
  onChange: (id: string) => void;
  taken?: (id: string) => boolean;
}) {
  const [allValues, setAllValues] = useState<string[]>([]);
  const variant = variants.find((v) => v.id === value) || variants[0];
  const axes = options.filter((o) => o.values.length > 1);
  const current = (name: string) =>
    variant?.options.find((o) => o.name === name)?.value || "";
  const match = (name: string, val: string) =>
    variants.find(
      (v) =>
        v.options.some((o) => o.name === name && o.value === val) &&
        axes.every(
          (a) =>
            a.name === name ||
            v.options.some((o) => o.name === a.name && o.value === current(a.name)),
        ),
    ) || null;
  const pick = (name: string, val: string) => {
    const next =
      match(name, val) ||
      variants.find((v) => v.options.some((o) => o.name === name && o.value === val));
    if (next) onChange(next.id);
  };
  return (
    <>
      {axes.map((axis) => {
        const open = allValues.includes(axis.name);
        const values =
          open || axis.values.length <= 12 ? axis.values : axis.values.slice(0, 11);
        const sel = current(axis.name);
        const visible = values.includes(sel) ? values : [...values, sel];
        return (
          <fieldset key={axis.name} className="product-option">
            <legend>
              {axis.name} · <strong>{sel}</strong>
              {axis.values.length > 6 && (
                <span className="muted"> {axis.values.length} choix</span>
              )}
            </legend>
            <div className="product-values">
              {visible.map((val) => {
                const exact = match(axis.name, val);
                const used = !!exact && !!taken?.(exact.id);
                return (
                  <button
                    key={val}
                    type="button"
                    aria-pressed={val === sel}
                    className={[exact ? "" : "unavailable", used ? "taken" : ""]
                      .filter(Boolean)
                      .join(" ")}
                    title={
                      used
                        ? "Déjà proposé dans le devis"
                        : exact
                          ? undefined
                          : "Pas avec ce choix : l'autre option changera"
                    }
                    onClick={() => pick(axis.name, val)}
                  >
                    {val}
                  </button>
                );
              })}
              {visible.length < axis.values.length && (
                <button
                  type="button"
                  className="more"
                  onClick={() => setAllValues([...allValues, axis.name])}
                >
                  + {axis.values.length - visible.length}
                </button>
              )}
            </div>
          </fieldset>
        );
      })}
    </>
  );
}
