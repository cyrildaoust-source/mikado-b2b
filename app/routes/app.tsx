import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import {
  Form,
  NavLink,
  Outlet,
  isRouteErrorResponse,
  useLocation,
  useLoaderData,
  useNavigation,
  useRouteError,
  useRouteLoaderData,
} from "react-router";
import { useEffect, useRef, useState } from "react";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { context } from "../services/context.server";
import { priceView, proPricing } from "../services/pro-price.server";
import type { PriceView, ProPricing } from "../domain/pro";
import { FinishChooserHost } from "../components/catalog/FinishChooser";

export async function loader({ request }: LoaderFunctionArgs) {
  const c = await context(request);
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    demo: c.demo,
    embedded: c.embedded,
    user: c.user,
    pro: await proPricing(request, c),
    view: c.embedded ? ("htva" as PriceView) : priceView(request),
  };
}
export default function App() {
  const { apiKey, demo, embedded, user, pro, view } =
    useLoaderData<typeof loader>();
  if (embedded)
    return (
      <AppProvider embedded apiKey={apiKey}>
        <Outlet />
        <FinishChooserHost />
      </AppProvider>
    );
  return (
    <div className="pro-app">
      <ProNav demo={demo} user={user} pro={pro} view={view} />
      <Outlet />
      <FinishChooserHost />
    </div>
  );
}

/** Prix affiché : HTVA, pro (classe de l'architecte) ou TVAC. Un réglage de
 * l'appareil, sans effet sur les devis ni les PDF. */
function PriceViewPicker({
  pro,
  view,
  next,
}: {
  pro: ProPricing | null;
  view: PriceView;
  next: string;
}) {
  const current = !pro && view === "pro" ? "htva" : view;
  const choices: { value: PriceView; label: string; title: string }[] = [
    { value: "htva", label: "HTVA", title: "Prix public hors TVA" },
    ...(pro
      ? [
          {
            value: "pro" as const,
            label: "Pro",
            title:
              pro.discount === null
                ? "Prix pro : aucune classe attribuée, à confirmer"
                : `Prix pro HTVA · ${pro.className} · remise de ${pro.discount} %`,
          },
        ]
      : []),
    { value: "tvac", label: "TVAC", title: "Prix public TVA comprise (21 %)" },
  ];
  return (
    <Form
      method="post"
      action="/app/prix-pro"
      className="pro-price-toggle"
      preventScrollReset
    >
      <input type="hidden" name="next" value={next} />
      <div className="price-switch" role="group" aria-label="Prix affichés">
        <span className="price-switch-label" aria-hidden="true">
          Prix
        </span>
        {choices.map((c) => (
          <button
            key={c.value}
            name="view"
            value={c.value}
            title={c.title}
            aria-pressed={current === c.value}
          >
            {c.label}
          </button>
        ))}
      </div>
    </Form>
  );
}

type NavUser = { name: string; role: string } | null | undefined;

/** Barre du haut. Sur téléphone, les liens passent dans un panneau qui
 * s'ouvre sous la barre, par-dessus la page : Échap, un clic en dehors ou
 * un changement de page le referment. */
function ProNav({
  demo,
  user,
  pro,
  view,
}: {
  demo: boolean;
  user: NavUser;
  pro: ProPricing | null;
  view: PriceView;
}) {
  const [open, setOpen] = useState(false);
  const { pathname, search } = useLocation();
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => setOpen(false), [pathname]);
  // Menu ouvert : la page derrière ne défile pas.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = before;
    };
  }, [open]);
  // Un seul devis par clic : le bouton attend la réponse du serveur.
  const nav = useNavigation();
  const creating =
    nav.state !== "idle" &&
    nav.formMethod === "POST" &&
    !!nav.formAction?.startsWith("/app?index");
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  useMenus();
  const account = demo ? "Mode local · catalogue fictif" : user?.name;
  return (
    <nav
      className={`pro-nav${open ? " menu-open" : ""}`}
      aria-label="Navigation principale"
    >
      <NavLink to="/app" end className="pro-brand">
        <span>
          Mikado Deco<span className="pro-brand-suffix"> · Pro</span>
        </span>
      </NavLink>
      <div className="pro-nav-links" id="pro-nav-links">
        <NavLink to="/app" end>
          <svg className="nav-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 7 8 2.5 13.5 7v6a.5.5 0 0 1-.5.5H9.5v-4h-3v4H3a.5.5 0 0 1-.5-.5z"/></svg>
          Accueil
        </NavLink>
        <NavLink to="/app/devis">
          <svg className="nav-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.5h5.5L12.5 4.5v9.5a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5z"/><path d="M9.5 1.5v3h3M5.5 8h5M5.5 10.5h5"/></svg>
          {user?.role === "admin" ? "Devis" : "Mes devis"}
        </NavLink>
        <NavLink to="/app/catalogue">
          <svg className="nav-icon" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>
          Catalogue
        </NavLink>
        {user?.role === "admin" && (
          <>
            <NavLink to="/app/marques">
              <svg className="nav-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 8.6V2.5a.5.5 0 0 1 .5-.5h6.1a1 1 0 0 1 .7.3l4.4 4.4a1 1 0 0 1 0 1.4l-5.6 5.6a1 1 0 0 1-1.4 0L2.3 9.3a1 1 0 0 1-.3-.7z"/><circle cx="5.2" cy="5.2" r=".9"/></svg>
              Marques
            </NavLink>
            <NavLink to="/app/matieres">
              <svg className="nav-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="m8 1.8 6 3.2-6 3.2L2 5z"/><path d="m2 8 6 3.2L14 8M2 11l6 3.2 6-3.2"/></svg>
              Matières
            </NavLink>
            <NavLink to="/app/a-facturer">
              <svg className="nav-icon" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="3.5" width="13" height="9" rx="1.5"/><path d="M1.5 6.5h13M4 10h3"/></svg>
              À facturer
            </NavLink>
            <NavLink to="/app/utilisateurs">
              <svg className="nav-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="6" cy="5.5" r="2.5"/><path d="M1.5 13.5c.3-2.4 2.1-4 4.5-4s4.2 1.6 4.5 4M11 3.2a2.5 2.5 0 0 1 0 4.6M12.5 9.9c1.2.6 1.9 1.9 2 3.6"/></svg>
              Accès
            </NavLink>
          </>
        )}
        {user && user.role !== "admin" && (
          <NavLink to="/app/cabinet">
            <svg className="nav-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 14V3a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 .5.5v11M9.5 6.5H13a.5.5 0 0 1 .5.5v7M1.5 14h13M5 5.5h2M5 8h2M5 10.5h2"/></svg>
            Mon cabinet
          </NavLink>
        )}
        {user && (
          <NavLink to="/app/parrainage">
            <svg className="nav-icon" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="6" width="12" height="8" rx="1"/><path d="M1.5 4h13v2h-13zM8 4v10M8 4C7 2 5.5 1.5 4.8 2.2 4 3 5 4 8 4zm0 0c1-2 2.5-2.5 3.2-1.8C12 3 11 4 8 4z"/></svg>
            Parrainage
          </NavLink>
        )}
        {open && (
          <div className="pro-nav-account">
            <span className="muted">{account}</span>
            <PriceViewPicker pro={pro} view={view} next={pathname + search} />
            {!demo && (
              <Form method="post" action="/deconnexion">
                <button>Se déconnecter</button>
              </Form>
            )}
          </div>
        )}
      </div>
      <div className="pro-nav-end">
        <Form method="post" action="/app?index" className="pro-new-quote">
          <button aria-label="Nouveau devis" disabled={creating}>
            <span>
              Nouveau<span className="nav-new-suffix"> devis</span>
            </span>
          </button>
        </Form>
        <PriceViewPicker pro={pro} view={view} next={pathname + search} />
        <span className="pro-user" title={account}>
          {account}
        </span>
        {!demo && (
          <Form method="post" action="/deconnexion" className="pro-logout-form">
            <button className="text-button pro-logout">Se déconnecter</button>
          </Form>
        )}
        <button
          ref={toggle}
          type="button"
          className="pro-nav-toggle"
          aria-expanded={open}
          aria-controls="pro-nav-links"
          onClick={() => setOpen(!open)}
        >
          {open ? "Fermer" : "Menu"}
        </button>
      </div>
      {open && (
        <div
          className="pro-nav-scrim"
          aria-hidden="true"
          onClick={() => setOpen(false)}
        />
      )}
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
      // Le menu reste dans l'écran : il s'ouvre du côté où il a la place.
      const pop = d.querySelector<HTMLElement>(":scope > div");
      if (!pop) return;
      pop.classList.remove("flip");
      const r = pop.getBoundingClientRect();
      if (r.right > window.innerWidth - 8 || r.left < 8) pop.classList.add("flip");
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
  if (
    isRouteErrorResponse(error) &&
    typeof error.data === "string" &&
    error.data.includes("<")
  )
    // Les réponses d'authentification Shopify portent du HTML à exécuter.
    return boundary.error(error);
  return <ErrorPage error={error} />;
}

/** Page d'erreur dans le cadre de l'outil : la barre du haut reste là quand
 * elle peut s'afficher, et deux chemins ramènent au travail. */
function ErrorPage({ error }: { error: unknown }) {
  const app = useRouteLoaderData<typeof loader>("routes/app");
  const status = isRouteErrorResponse(error) ? error.status : 500;
  const detail =
    isRouteErrorResponse(error) && typeof error.data === "string"
      ? error.data
      : "";
  const title =
    status === 404
      ? "Page introuvable"
      : status === 403 || status === 401
        ? "Accès réservé"
        : "Une erreur est survenue";
  const text =
    status === 404
      ? detail && detail !== "Not Found"
        ? `${detail}. Il a peut-être été supprimé, ou le lien est incomplet.`
        : "Cette adresse ne mène à aucune page de l'outil. Le lien est peut-être incomplet."
      : status === 403 || status === 401
        ? detail || "Cette page est réservée à Mikado Deco."
        : "Rechargez la page. Si le problème persiste, prévenez Mikado Deco.";
  const body = (
    <main className="workspace error-page">
      <div className="error-card">
        <p className="error-code">
          {status === 500 ? "Erreur" : `Erreur ${status}`}
        </p>
        <h1>{title}</h1>
        <p>{text}</p>
        <div className="error-actions">
          <a
            className="button primary"
            href={app && !app.embedded ? "/app/devis" : "/app"}
          >
            Voir les devis
          </a>
          <a className="button" href="/app/catalogue">
            Ouvrir le catalogue
          </a>
        </div>
      </div>
    </main>
  );
  if (!app || app.embedded) return body;
  return (
    <div className="pro-app">
      <ProNav demo={app.demo} user={app.user} pro={null} view="htva" />
      {body}
    </div>
  );
}
export const headers: HeadersFunction = (args) => boundary.headers(args);
