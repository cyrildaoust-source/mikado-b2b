import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import {
  Form,
  NavLink,
  Outlet,
  isRouteErrorResponse,
  useLocation,
  useLoaderData,
  useRouteError,
} from "react-router";
import { useEffect, useState } from "react";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { context } from "../services/context.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const c = await context(request);
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    demo: c.demo,
    embedded: c.embedded,
    user: c.user,
  };
}
export default function App() {
  const { apiKey, demo, embedded, user } = useLoaderData<typeof loader>();
  if (embedded)
    return (
      <AppProvider embedded apiKey={apiKey}>
        <Outlet />
      </AppProvider>
    );
  return (
    <div className="pro-app">
      <ProNav demo={demo} user={user} />
      <Outlet />
    </div>
  );
}

/** Barre du haut. Sur téléphone, les liens passent dans un menu. */
function ProNav({
  demo,
  user,
}: {
  demo: boolean;
  user: { name: string; role: string } | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  useMenus();
  return (
    <nav
      className={`pro-nav${open ? " menu-open" : ""}`}
      aria-label="Navigation principale"
    >
      <NavLink to="/app/catalogue" className="pro-brand">
        Mikado Deco · Pro
      </NavLink>
      <div className="pro-nav-links" id="pro-nav-links">
        <NavLink to="/app" end>
          {user?.role === "admin" ? "Devis" : "Mes devis"}
        </NavLink>
        <NavLink to="/app/catalogue">Catalogue</NavLink>
        {user?.role === "admin" && (
          <>
            <NavLink to="/app/marques">Marques</NavLink>
            <NavLink to="/app/utilisateurs">Accès</NavLink>
          </>
        )}
        {open && (
          <div className="pro-nav-account">
            <span className="muted">
              {demo ? "Mode local · catalogue fictif" : user?.name}
            </span>
            {!demo && (
              <Form method="post" action="/deconnexion">
                <button className="text-button">Se déconnecter</button>
              </Form>
            )}
          </div>
        )}
      </div>
      <div className="pro-nav-end">
        <Form method="post" action="/app?index" className="pro-new-quote">
          <button>Nouveau devis</button>
        </Form>
        <span className="pro-user">
          {demo ? "Mode local · catalogue fictif" : user?.name}
        </span>
        {!demo && (
          <Form method="post" action="/deconnexion" className="pro-logout-form">
            <button className="text-button pro-logout">Se déconnecter</button>
          </Form>
        )}
        <button
          type="button"
          className="pro-nav-toggle"
          aria-expanded={open}
          aria-controls="pro-nav-links"
          onClick={() => setOpen(!open)}
        >
          {open ? "Fermer" : "Menu"}
        </button>
      </div>
    </nav>
  );
}

/** Menus déroulants (details) : un seul ouvert à la fois, fermés par Échap
 * (le focus revient sur le menu) ou par un clic en dehors. */
function useMenus() {
  useEffect(() => {
    const menus = () =>
      document.querySelectorAll<HTMLDetailsElement>(
        "details.action-menu[open], details.brand-picker[open]",
      );
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      menus().forEach((d) => {
        d.open = false;
        d.querySelector("summary")?.focus();
      });
    };
    const onDown = (e: PointerEvent) => {
      menus().forEach((d) => {
        if (!d.contains(e.target as Node)) d.open = false;
      });
    };
    const onToggle = (e: Event) => {
      const d = e.target as HTMLDetailsElement;
      if (!d.open || !d.matches?.(".action-menu, .brand-picker")) return;
      menus().forEach((m) => m !== d && (m.open = false));
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("toggle", onToggle, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("toggle", onToggle, true);
    };
  }, []);
}
export function ErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error)) {
    // Les réponses d'authentification Shopify portent du HTML à exécuter.
    if (typeof error.data === "string" && error.data.includes("<"))
      return boundary.error(error);
    return (
      <main className="workspace">
        <h1>
          {error.status === 404 ? "Page introuvable" : "Accès impossible"}
        </h1>
        <p>{typeof error.data === "string" ? error.data : error.statusText}</p>
        <p>
          <a href="/app/catalogue">Retour au catalogue</a>
        </p>
      </main>
    );
  }
  return (
    <main className="workspace">
      <h1>Une erreur est survenue</h1>
      <p>Rechargez la page. Si le problème persiste, prévenez Mikado Deco.</p>
    </main>
  );
}
export const headers: HeadersFunction = (args) => boundary.headers(args);
