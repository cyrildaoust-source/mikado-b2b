import type { LoaderFunctionArgs } from "react-router";
import { context } from "../services/context.server";
import {
  products,
  customers,
  productsByIds,
} from "../services/shopify-api.server";
import {
  brandRules,
  getCatalogProduct,
  demoProducts,
  visibilityQuery,
} from "../services/catalog.server";
import { lineFor } from "../services/catalog-quote.server";
export async function loader({ request }: LoaderFunctionArgs) {
  const c = await context(request),
    u = new URL(request.url),
    q = (u.searchParams.get("q") || "").slice(0, 150),
    after = u.searchParams.get("after") || undefined;
  if (u.searchParams.get("kind") === "customers" && c.user?.role === "architect")
    // Les clients de la boutique restent privés : l'architecte saisit les siens.
    return Response.json(
      { items: [], next: null, error: "Saisissez les coordonnées de votre client dans le devis." },
      { headers: { "Cache-Control": "no-store" } },
    );
  if (u.searchParams.get("kind") === "family") {
    // Famille d'un produit déjà au devis (lignes ajoutées avant qu'on l'enregistre).
    const variant = u.searchParams.get("variante") || "",
      sku = (u.searchParams.get("sku") || "").slice(0, 150);
    let family = "";
    try {
      if (c.admin && /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(variant))
        family = (await productsByIds(c.admin, [variant])).items[0]?.family || "";
      else if (!c.admin && sku)
        family =
          demoProducts.find((p) => p.productVariants.some((v) => v.sku === sku))
            ?.productType || "";
    } catch {
      family = "";
    }
    return Response.json({ family }, { headers: { "Cache-Control": "no-store" } });
  }
  if (u.searchParams.get("kind") === "product") {
    // Finitions d'un produit, pour les choisir au moment de l'ajout.
    const product = await getCatalogProduct(
      c.admin,
      u.searchParams.get("produit") || "",
    ).catch(() => null);
    if (!product)
      return Response.json(
        { error: "Ce produit n'est plus au catalogue." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    const { title, vendor, image, imageAlt, options, productVariants } = product;
    return Response.json(
      { title, vendor, image, imageAlt, options, variants: productVariants },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  if (u.searchParams.get("kind") === "line") {
    // Une carte du catalogue glissée dans le devis : même ligne que l'ajout
    // rapide, avec les mêmes règles de visibilité des marques.
    try {
      const product = await getCatalogProduct(
        c.admin,
        u.searchParams.get("produit") || "",
      );
      if (!product) throw Error("Ce produit n'est plus au catalogue.");
      const line = await lineFor(
        c.admin,
        product,
        u.searchParams.get("variante") || "",
      );
      return Response.json(
        { items: [line], next: null },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (e) {
      return Response.json(
        { error: e instanceof Error ? e.message : "Produit indisponible." },
        { status: 404 },
      );
    }
  }
  try {
    return Response.json(
      await (u.searchParams.get("kind") === "variants"
        ? productsByIds(c.admin, (u.searchParams.get("ids") || "").split(","))
        : u.searchParams.get("kind") === "customers"
          ? customers(c.admin, q, after)
          : products(
              c.admin,
              q,
              after,
              // Hors admin Shopify : mêmes fiches que le catalogue pro.
              c.embedded ? undefined : visibilityQuery(await brandRules(), "product_status"),
            )),
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
