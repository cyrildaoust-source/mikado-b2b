import { useState } from "react";
import {
  Form,
  Link,
  data,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { context, ownerScope } from "../services/context.server";
import { getCatalogProduct } from "../services/catalog.server";
import {
  addToQuote,
  openQuotes,
  parsePlacement,
} from "../services/catalog-quote.server";
import {
  currentQuoteId,
  quotePanel,
  rememberQuote,
} from "../services/current-quote.server";
import { readForm } from "../services/form.server";
import { money } from "../domain/quote";
import { sized } from "../components/catalog/image";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const c = await context(request);
  const product = await getCatalogProduct(c.admin, String(params.id));
  if (!product) throw new Response("Produit introuvable", { status: 404 });
  const [quotes, panel] = await Promise.all([
    openQuotes(c.shop, ownerScope(c)),
    currentQuoteId(request).then((id) => quotePanel(c.shop, id, ownerScope(c))),
  ]);
  const wanted = new URL(request.url).searchParams.get("variante") || "";
  const initial =
    product.productVariants.find((v) => v.id.endsWith(`/${wanted}`))?.id ||
    product.productVariants[0]?.id;
  return { product, quotes, panel, initial, demo: c.demo };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const c = await context(request);
  const product = await getCatalogProduct(c.admin, String(params.id));
  if (!product) throw new Response("Produit introuvable", { status: 404 });
  const form = await readForm(request),
    target = String(form.get("quote") || "new");
  if (form.get("intent") === "close")
    return data(
      { ok: "", error: "" },
      { headers: { "Set-Cookie": await rememberQuote(null) } },
    );
  const open = await currentQuoteId(request);
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
      placement: parsePlacement(String(form.get("placement") || "")),
    });
    // Devis ouvert à côté : on reste sur la fiche, le panneau se met à jour.
    if (id === open) return { ok: "Ajouté au devis.", error: "" };
    return redirect(`/app/quotes/${id}`);
  } catch (e) {
    return {
      ok: "",
      error:
        e instanceof Error && e.name !== "ZodError"
          ? e.message
          : "Ajout impossible. Rechargez la page et réessayez.",
    };
  }
}

const sameImage = (a: string, b: string) => a.split("?")[0] === b.split("?")[0];

export default function Product() {
  const { product, quotes, panel, initial, demo } =
    useLoaderData<typeof loader>();
  const [quoteId, setQuoteId] = useState(String(panel?.id ?? quotes[0]?.id ?? "new"));
  const [placement, setPlacement] = useState("end");
  const inPanel = panel !== null && quoteId === String(panel.id);
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
      <div className={panel ? "product-layout with-quote" : "product-layout"}>
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
              <select
                name="quote"
                value={quoteId}
                onChange={(e) => {
                  setQuoteId(e.target.value);
                  setPlacement("end");
                }}
              >
                <option value="new">Nouveau devis</option>
                {quotes.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.title}
                    {q.customer ? ` · ${q.customer}` : ""} ({q.number})
                  </option>
                ))}
              </select>
            </label>
            {inPanel && panel && (
              <label>
                Où l’ajouter
                <select
                  name="placement"
                  value={placement}
                  onChange={(e) => setPlacement(e.target.value)}
                >
                  <option value="end">À la suite du devis</option>
                  {panel.sections.map((section) => (
                    <optgroup key={section.id} label={section.title}>
                      <option value={`section:${section.id}`}>
                        Nouveau produit dans « {section.title} »
                      </option>
                      {section.groups.map((g) => (
                        <option key={g.id} value={`alternative:${g.id}`}>
                          Alternative à {g.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                  <option value="option">En option (hors total)</option>
                </select>
              </label>
            )}
            <button className="primary" disabled={busy || !variant}>
              Ajouter au devis
            </button>
            {result?.ok && (
              <p role="status" className="success">
                {result.ok}
              </p>
            )}
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
        {panel && (
          <aside className="quote-panel" aria-label="Devis ouvert">
            <header>
              <small>Devis ouvert · {panel.number}</small>
              <strong>{panel.title}</strong>
              <span>{money(panel.total)} HTVA</span>
            </header>
            {panel.sections.length === 0 && (
              <p className="muted">Ce devis est encore vide.</p>
            )}
            {panel.sections.map((section) => (
              <section key={section.id}>
                <div className="quote-panel-room">
                  <h3>{section.title}</h3>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setQuoteId(String(panel.id));
                      setPlacement(`section:${section.id}`);
                    }}
                  >
                    + ici
                  </button>
                </div>
                <ul>
                  {section.groups.map((g) => (
                    <li
                      key={g.id}
                      className={
                        inPanel && placement === `alternative:${g.id}`
                          ? "active"
                          : ""
                      }
                    >
                      {g.image ? (
                        <img src={sized(g.image, 96)} alt="" loading="lazy" />
                      ) : (
                        <span className="thumb" />
                      )}
                      <span>
                        {g.name}
                        {g.alternatives > 0 && (
                          <small>
                            {" "}
                            · {g.alternatives} alternative
                            {g.alternatives > 1 ? "s" : ""}
                          </small>
                        )}
                      </span>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => {
                          setQuoteId(String(panel.id));
                          setPlacement(`alternative:${g.id}`);
                        }}
                      >
                        + alternative
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {panel.options > 0 && (
              <p className="muted">
                {panel.options} option{panel.options > 1 ? "s" : ""} hors total
              </p>
            )}
            <footer>
              <Link to={`/app/quotes/${panel.id}`}>Ouvrir le devis</Link>
              <Form method="post">
                <button name="intent" value="close" className="text-button">
                  Fermer
                </button>
              </Form>
            </footer>
          </aside>
        )}
      </div>
    </main>
  );
}
