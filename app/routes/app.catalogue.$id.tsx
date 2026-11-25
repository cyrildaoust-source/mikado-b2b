import { useState } from "react";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { context, ownerScope } from "../services/context.server";
import { getCatalogProduct } from "../services/catalog.server";
import { addToQuote, openQuotes } from "../services/catalog-quote.server";
import { readForm } from "../services/form.server";
import { money } from "../domain/quote";
import { sized } from "../components/catalog/image";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const c = await context(request);
  const product = await getCatalogProduct(c.admin, String(params.id));
  if (!product) throw new Response("Produit introuvable", { status: 404 });
  const quotes = await openQuotes(c.shop, ownerScope(c));
  const wanted = new URL(request.url).searchParams.get("variante") || "";
  const initial =
    product.productVariants.find((v) => v.id.endsWith(`/${wanted}`))?.id ||
    product.productVariants[0]?.id;
  return { product, quotes, initial, demo: c.demo };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const c = await context(request);
  const product = await getCatalogProduct(c.admin, String(params.id));
  if (!product) throw new Response("Produit introuvable", { status: 404 });
  const form = await readForm(request),
    target = String(form.get("quote") || "new");
  try {
    const id = await addToQuote({
      shop: c.shop,
      admin: c.admin,
      owner: ownerScope(c),
      ownerId: c.user?.id || null,
      product,
      variantId: String(form.get("variant")),
      qty: Number(form.get("qty")),
      quoteId: target === "new" ? "new" : Number(target),
    });
    return redirect(`/app/quotes/${id}`);
  } catch (e) {
    return {
      error:
        e instanceof Error && e.name !== "ZodError"
          ? e.message
          : "Ajout impossible. Rechargez la page et réessayez.",
    };
  }
}

const sameImage = (a: string, b: string) => a.split("?")[0] === b.split("?")[0];

export default function Product() {
  const { product, quotes, initial, demo } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  const [variantId, setVariantId] = useState(initial);
  const variant =
    product.productVariants.find((v) => v.id === variantId) ||
    product.productVariants[0];
  // Photo de la variante d'abord, puis les photos d'ambiance du produit.
  const base = product.images.length
    ? product.images
    : product.image
      ? [{ url: product.image, alt: product.imageAlt }]
      : [];
  const own = variant?.image ? [{ url: variant.image, alt: product.title }] : [];
  const images = [
    ...own,
    ...base.filter((i) => !own.some((o) => sameImage(o.url, i.url))),
  ];
  const [shown, setShown] = useState<number | null>(null);
  const photo = images[shown ?? 0];
  const finish = variant && variant.title !== "Default Title" ? variant.title : "";
  return (
    <main className="workspace product-page">
      <p className="breadcrumb">
        <Link to="/app/catalogue">Catalogue</Link> ·{" "}
        <Link to={`/app/catalogue?marque=${encodeURIComponent(product.vendor)}`}>
          {product.vendor}
        </Link>
      </p>
      {demo && <p className="demo-ribbon">Démonstration · catalogue fictif</p>}
      <div className="product-layout">
        <section className="product-gallery" aria-label="Photos">
          <div className="product-photo">
            {photo ? (
              <img src={sized(photo.url, 1200)} alt={photo.alt} />
            ) : (
              <span>Photo à venir</span>
            )}
          </div>
          {images.length > 1 && (
            <div className="product-thumbs">
              {images.map((img, i) => (
                <button
                  key={img.url}
                  type="button"
                  className={photo?.url === img.url ? "active" : ""}
                  onClick={() => setShown(i)}
                  aria-label={`Photo ${i + 1}`}
                >
                  <img src={sized(img.url, 160)} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </section>
        <section className="product-info">
          <small className="product-vendor">{product.vendor}</small>
          <h1>{product.title}</h1>
          {finish && <p className="product-finish">{finish}</p>}
          {product.productType && (
            <p className="muted">{product.productType}</p>
          )}
          {variant && (
            <p className="product-price">
              {money(variant.price)} <small>HTVA · prix public</small>
            </p>
          )}
          <Form method="post" className="product-add">
            {product.productVariants.length > 1 && (
              <label>
                Finition
                <select
                  name="variant"
                  value={variantId}
                  onChange={(e) => {
                    setVariantId(e.target.value);
                    setShown(null);
                  }}
                >
                  {product.productVariants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.title} · {money(v.price)} HTVA
                    </option>
                  ))}
                </select>
              </label>
            )}
            {product.productVariants.length === 1 && (
              <input type="hidden" name="variant" value={variant?.id} />
            )}
            <label>
              Quantité
              <input
                name="qty"
                type="number"
                min={1}
                max={10000}
                defaultValue={1}
                required
              />
            </label>
            <label>
              Devis
              <select name="quote" defaultValue={quotes[0]?.id ?? "new"}>
                <option value="new">Nouveau devis</option>
                {quotes.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.title}
                    {q.customer ? ` · ${q.customer}` : ""} ({q.number})
                  </option>
                ))}
              </select>
            </label>
            <button className="primary" disabled={busy || !variant}>
              Ajouter au devis
            </button>
            {result?.error && (
              <p role="alert" className="error">
                {result.error}
              </p>
            )}
          </Form>
          {variant?.sku && <p className="muted">Référence {variant.sku}</p>}
          {product.description && (
            <div className="product-description">
              {product.description.split(/\n+/).map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
