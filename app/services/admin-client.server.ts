import type { Admin } from "./shopify-api.server";

// Accès serveur à l'API Admin pour une app du Dev Dashboard installée sur la
// boutique de la même organisation (client credentials grant, jeton de 24 h).
const API_VERSION = "2026-07";
let cached: { token: string; expires: number } | null = null;
let pending: Promise<string> | null = null;

function shopDomain() {
  const shop = process.env.SHOPIFY_SHOP || "";
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop))
    throw Error(
      "SHOPIFY_SHOP doit être le domaine *.myshopify.com de la boutique.",
    );
  return shop;
}

async function fetchToken(): Promise<string> {
  const id = process.env.SHOPIFY_API_KEY,
    secret = process.env.SHOPIFY_API_SECRET;
  if (!id || !secret) throw Error("Identifiants de l'app Shopify manquants.");
  const r = await fetch(`https://${shopDomain()}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: id,
      client_secret: secret,
    }),
  });
  if (!r.ok) throw Error(`Jeton Shopify refusé (${r.status}).`);
  const body = (await r.json()) as { access_token: string; expires_in: number };
  cached = {
    token: body.access_token,
    // Renouveler une heure avant l'expiration annoncée.
    expires: Date.now() + Math.max(60, body.expires_in - 3600) * 1000,
  };
  return cached.token;
}

async function token() {
  if (cached && cached.expires > Date.now()) return cached.token;
  pending ??= fetchToken().finally(() => (pending = null));
  return pending;
}

export function standaloneAdmin(): Admin {
  return {
    async graphql(query, options) {
      const send = async (t: string) =>
        fetch(
          `https://${shopDomain()}/admin/api/${API_VERSION}/graphql.json`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": t,
            },
            body: JSON.stringify({
              query,
              variables: options?.variables || {},
            }),
          },
        );
      let response = await send(await token());
      if (response.status === 401) {
        cached = null;
        response = await send(await token());
      }
      return response;
    },
  };
}

export function standaloneShop() {
  return shopDomain();
}
