import type { LoaderFunctionArgs } from "react-router";
import { context } from "../services/context.server";
import {
  products,
  customers,
  productsByIds,
} from "../services/shopify-api.server";
export async function loader({ request }: LoaderFunctionArgs) {
  const c = await context(request),
    u = new URL(request.url),
    q = (u.searchParams.get("q") || "").slice(0, 150),
    after = u.searchParams.get("after") || undefined;
  try {
    return Response.json(
      await (u.searchParams.get("kind") === "variants"
        ? productsByIds(c.admin, (u.searchParams.get("ids") || "").split(","))
        : u.searchParams.get("kind") === "customers"
          ? customers(c.admin, q, after)
          : products(c.admin, q, after)),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      {
        error:
          "Recherche Shopify indisponible. Vérifiez les autorisations puis réessayez.",
      },
      { status: 502 },
    );
  }
}
