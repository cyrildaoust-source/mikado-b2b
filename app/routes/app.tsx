import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError, Link } from "react-router";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { context } from "../services/context.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const c = await context(request);
  return { apiKey: process.env.SHOPIFY_API_KEY || "", demo: c.demo };
}
export default function App() {
  const { apiKey, demo } = useLoaderData<typeof loader>();
  return demo ? (
    <>
      <div className="localbar">
        <Link to="/app">Mikado · Devis</Link>
        <span>Mode local · catalogue fictif · sauvegarde serveur</span>
      </div>
      <Outlet />
    </>
  ) : (
    <AppProvider embedded apiKey={apiKey}>
      <Outlet />
    </AppProvider>
  );
}
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
export const headers: HeadersFunction = (args) => boundary.headers(args);
