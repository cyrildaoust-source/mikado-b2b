import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import {
  Form,
  NavLink,
  Outlet,
  isRouteErrorResponse,
  useLoaderData,
  useRouteError,
} from "react-router";
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
    <>
      <nav className="localbar pro-nav" aria-label="Navigation principale">
        <NavLink to="/app/catalogue" className="pro-brand">
          Mikado Deco · Pro
        </NavLink>
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
        <Form method="post" action="/app?index" className="pro-new-quote">
          <button className="primary">Nouveau devis</button>
        </Form>
        <span className="pro-user">
          {demo ? "Mode local · catalogue fictif" : user?.name}
        </span>
        {!demo && (
          <Form method="post" action="/deconnexion">
            <button className="text-button">Se déconnecter</button>
          </Form>
        )}
      </nav>
      <Outlet />
    </>
  );
}
export function ErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error)) {
    // Les réponses d'authentification Shopify portent du HTML à exécuter.
    if (typeof error.data === "string" && error.data.includes("<"))
      return boundary.error(error);
    return (
      <main className="workspace">
        <h1>{error.status === 404 ? "Page introuvable" : "Accès impossible"}</h1>
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
