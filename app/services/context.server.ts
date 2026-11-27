import type { Admin } from "./shopify-api.server";
import type { SessionUser } from "./auth.server";
import { isStandalone } from "./mode.server";

export function isDemo() {
  if (
    process.env.APP_DEMO_MODE === "true" &&
    process.env.NODE_ENV === "production" &&
    !(process.env.VERCEL_ENV === "preview" && process.env.PREVIEW_URL)
  )
    throw new Error("Le mode de démonstration est interdit en production.");
  return process.env.APP_DEMO_MODE === "true";
}

export type Context = {
  shop: string;
  admin: Admin | null;
  demo: boolean;
  actor: string | null;
  /** Ouvert dans l'admin Shopify (App Bridge disponible). */
  embedded: boolean;
  /** Compte de l'outil pro ; null dans l'admin Shopify. */
  user: SessionUser | null;
};

const demoUser: SessionUser = {
  id: 0,
  email: "demo@local",
  name: "Démonstration",
  role: "admin",
};

export async function context(request: Request): Promise<Context> {
  if (isDemo()) {
    const u = new URL(request.url);
    // Démo : en local, ou dans une préversion Vercel, protégée par la
    // connexion Vercel et reliée à la base de test (db.server, vercel-build).
    const preview = process.env.VERCEL_ENV === "preview" && Boolean(process.env.PREVIEW_URL);
    if (!preview && !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname))
      throw new Response("Mode local uniquement", { status: 403 });
    const origin = request.headers.get("origin");
    if (
      request.method !== "GET" &&
      (!origin || new URL(origin).host !== u.host)
    )
      throw new Response("Origine refusée", { status: 403 });
    return {
      shop: "demo.local",
      admin: null,
      demo: true,
      actor: "demo",
      embedded: false,
      user: demoUser,
    };
  }
  if (isStandalone()) {
    const { requireUser } = await import("./auth.server");
    const { standaloneAdmin, standaloneShop } = await import(
      "./admin-client.server"
    );
    const user = await requireUser(request);
    return {
      shop: standaloneShop(),
      admin: standaloneAdmin(),
      demo: false,
      actor: `user:${user.id}`,
      embedded: false,
      user,
    };
  }
  const { authenticate } = await import("../shopify.server");
  const result = await authenticate.admin(request);
  const { session, admin } = result;
  const actor =
    ("sessionToken" in result ? String(result.sessionToken.sub) : null) || null;
  return { shop: session.shop, admin, demo: false, actor, embedded: true, user: null };
}

/** Propriétaire à filtrer : une architecte ne voit que ses devis. */
export function ownerScope(c: Context): number | null {
  return c.user && c.user.role !== "admin" ? c.user.id : null;
}

export function requireAdmin(c: Context) {
  if (c.user && c.user.role !== "admin")
    throw new Response("Réservé à Mikado Deco", { status: 403 });
}
