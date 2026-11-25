import { Link } from "react-router";

export type Crumb = {
  label: string;
  to?: string;
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
};

/** Fil d'Ariane de l'outil pro : la dernière étape est la page ouverte. */
export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav className="breadcrumb" aria-label="Fil d'Ariane">
      <ol>
        {items.map((c, n) => (
          <li key={`${n}-${c.label}`}>
            {c.to && n < items.length - 1 ? (
              <Link to={c.to} onClick={c.onClick}>
                {c.label}
              </Link>
            ) : (
              <span aria-current={n === items.length - 1 ? "page" : undefined}>
                {c.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
