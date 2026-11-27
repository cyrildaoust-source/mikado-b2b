import { useEffect } from "react";
import type { LoaderFunctionArgs } from "react-router";
import appCss from "./styles/app.css?url";
import documentCss from "./styles/document.css?url";
import refonteCss from "./styles/refonte.css?url";
import proCss from "./styles/pro.css?url";
import outilCss from "./styles/outil.css?url";
import dashboardCss from "./styles/dashboard.css?url";
import classesCss from "./styles/classes.css?url";
import parrainageCss from "./styles/parrainage.css?url";
import finitionCatalogueCss from "./styles/finition-catalogue.css?url";
import finitionDevisCss from "./styles/finition-devis.css?url";
import finitionMoodboardCss from "./styles/finition-moodboard.css?url";
import finitionPagesCss from "./styles/finition-pages.css?url";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useRouteError,
  useRouteLoaderData,
} from "react-router";
import { isDemo } from "./services/context.server";
import { isStandalone } from "./services/mode.server";

export const meta = () => [
  { title: "Mikado Deco Pro" },
  // Outil privé : aucune page n'a à apparaître dans un moteur de recherche.
  { name: "robots", content: "noindex, nofollow" },
];

// Une feuille de style par usage. L'outil pro (autonome ou démo) n'a que la
// sienne, outil.css ; l'app intégrée à l'admin Shopify garde les anciennes.
// document.css habille le devis (aperçu), le PDF l'embarque à part.
const STYLES = {
  pro: [
    documentCss,
    outilCss,
    finitionPagesCss,
    finitionCatalogueCss,
    finitionDevisCss,
    finitionMoodboardCss,
    dashboardCss,
    classesCss,
    parrainageCss,
  ],
  admin: [appCss, documentCss, refonteCss, proCss],
};

export async function loader(_: LoaderFunctionArgs) {
  return { pro: isDemo() || isStandalone() };
}

// Vercel : une seule fonction pour toute l'app, assez longue et large pour le PDF
// (Chromium). Une config par route coupait l'app en deux fonctions.
export const config = { maxDuration: 60, memory: 2048 };

export default function App() {
  const pro = useRouteLoaderData<typeof loader>("root")?.pro ?? false;
  useEffect(() => {
    if (document.getElementById("polaris-script")) return;
    // Outil pro : pas de composants Polaris, outil.css habille s-section et
    // s-badge. Polaris reste chargé dans l'admin Shopify.
    if (pro) return;
    const script = document.createElement("script");
    script.id = "polaris-script";
    script.src = "https://cdn.shopify.com/shopifycloud/polaris.js";
    document.head.appendChild(script);
  }, [pro]);
  return (
    <html lang="fr">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        {!pro && (
          <>
            <link rel="preconnect" href="https://cdn.shopify.com/" />
            <link
              rel="stylesheet"
              href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
            />
          </>
        )}
        <Meta />
        {(pro ? STYLES.pro : STYLES.admin).map((href) => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

/**
 * Erreur hors de /app (adresse inconnue, lien mal copié) : une page sobre en
 * français, aux couleurs de l'outil. Sans elle, le visiteur voyait la page
 * anglaise de React Router (« Unhandled Thrown Response! », audit 27/11).
 */
export function ErrorBoundary() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : 500;
  const missing = status === 404 || status === 410;
  return (
    <html lang="fr">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <title>{missing ? "Page introuvable" : "Erreur"} · Mikado Deco</title>
        {STYLES.pro.map((href) => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
      </head>
      <body>
        <main className="workspace error-page">
          <div className="error-card">
            <p className="error-code">
              {missing ? `Erreur ${status}` : "Erreur"}
            </p>
            <h1>{missing ? "Page introuvable" : "Une erreur est survenue"}</h1>
            <p>
              {missing
                ? "Cette adresse ne mène à aucune page. Le lien est peut-être incomplet."
                : "Rechargez la page. Si le problème persiste, prévenez Mikado Deco."}
            </p>
            <div className="error-actions">
              <a className="button primary" href="/app">
                Ouvrir Mikado Deco Pro
              </a>
            </div>
          </div>
        </main>
        <Scripts />
      </body>
    </html>
  );
}
