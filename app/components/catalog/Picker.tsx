import { useRef, useState } from "react";

/** Menu déroulant à choix multiples, avec recherche au-delà de huit choix.
 * Chaque case s'applique tout de suite ; le menu se ferme au clic dehors
 * ou avec Échap (voir useMenus dans app.tsx). */
export function Picker({
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
        {selected.length > 0 && (
          <div className="picker-foot">
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
          </div>
        )}
      </div>
    </details>
  );
}
