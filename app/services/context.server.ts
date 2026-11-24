export function isDemo() {
  if (
    process.env.APP_DEMO_MODE === "true" &&
    process.env.NODE_ENV === "production"
  )
    throw new Error("Le mode de démonstration est interdit en production.");
  return process.env.APP_DEMO_MODE === "true";
}
export async function context(request: Request) {
  if (isDemo()) {
    const u = new URL(request.url);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(u.hostname))
      throw new Response("Mode local uniquement", { status: 403 });
    const origin = request.headers.get("origin");
    if (
      request.method !== "GET" &&
      (!origin || new URL(origin).host !== u.host)
    )
      throw new Response("Origine refusée", { status: 403 });
    return { shop: "demo.local", admin: null, demo: true, actor: "demo" };
  }
  const { authenticate } = await import("../shopify.server");
  const result = await authenticate.admin(request);
  const { session, admin } = result;
  const actor =
    ("sessionToken" in result ? String(result.sessionToken.sub) : null) || null;
  return { shop: session.shop, admin, demo: false, actor };
}
