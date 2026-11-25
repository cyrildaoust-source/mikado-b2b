import { useEffect } from "react";
import appCss from "./styles/app.css?url";
import documentCss from "./styles/document.css?url";
import refonteCss from "./styles/refonte.css?url";
import proCss from "./styles/pro.css?url";
export const links = () => [
  { rel: "stylesheet", href: appCss },
  { rel: "stylesheet", href: documentCss },
  { rel: "stylesheet", href: refonteCss },
  { rel: "stylesheet", href: proCss },
];
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

// Vercel : une seule fonction pour toute l'app, assez longue et large pour le PDF
// (Chromium). Une config par route coupait l'app en deux fonctions.
export const config = { maxDuration: 60, memory: 2048 };

export default function App() {
  useEffect(() => {
    if (document.getElementById("polaris-script")) return;
    const script = document.createElement("script");
    script.id = "polaris-script";
    script.src = "https://cdn.shopify.com/shopifycloud/polaris.js";
    document.head.appendChild(script);
  }, []);
  return (
    <html lang="fr">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
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
