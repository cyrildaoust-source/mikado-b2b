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
  undoAdd,
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
    if (form.get("intent") === "undo") {
      await undoAdd({
        shop: c.shop,
        owner: ownerScope(c),
        quoteId: Number(form.get("quote")),
        lineId: String(form.get("line")).slice(0, 100),
      });
      return { ok: "Ajout annulé.", error: "" };
    }
    const { id, lineId } = await addToQuote({
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
    if (id === open)
      return { ok: "Ajouté au devis.", error: "", quote: id, line: lineId };
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

type Target = { quote: string; placement: string; label: string; button: string };

export default function Product() {
  const { product, quotes, panel, initial, demo } =
    useLoaderData<typeof loader>();
  const [quoteId, setQuoteId] = useState(String(panel?.id ?? quotes[0]?.id ?? "new"));
  const [placement, setPlacement] = useState("end");
  const inPanel = panel !== null && quoteId === String(panel.id);
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  const [variantId, setVariantId] = useState(initial);
  const [qty, setQty] = useState(1);
  const [allValues, setAllValues] = useState<string[]>([]);
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

  // Une rangée par option Shopify ; une combinaison absente est grisée.
  const axes = product.options.filter((o) => o.values.length > 1);
  const current = (name: string) =>
    variant?.options.find((o) => o.name === name)?.value || "";
  const match = (name: string, value: string) => {
    const wanted = (v: (typeof product.productVariants)[number]) =>
      v.options.some((o) => o.name === name && o.value === value);
    return (
      product.productVariants.find(
        (v) =>
          wanted(v) &&
          axes.every(
            (a) => a.name === name || v.options.some((o) => o.name === a.name && o.value === current(a.name)),
          ),
      ) || null
    );
  };
  const pick = (name: string, value: string) => {
    const exact = match(name, value);
    const any = product.productVariants.find((v) =>
      v.options.some((o) => o.name === name && o.value === value),
    );
    const next = exact || any;
    if (next) {
      setVariantId(next.id);
      setShown(null);
    }
  };

  // Un seul choix « Ajouter à » : devis, pièce, alternative, option.
  const targets: { group: string; items: Target[] }[] = [];
  if (panel) {
    for (const section of panel.sections)
      targets.push({
        group: `${panel.title} · ${section.title}`,
        items: [
          {
            quote: String(panel.id),
            placement: `section:${section.id}`,
            label: `Nouveau produit dans ${section.title}`,
            button: `Ajouter à ${section.title}`,
          },
          ...section.groups.map((g) => ({
            quote: String(panel.id),
            placement: `alternative:${g.id}`,
            label: `Alternative à ${g.name}`,
            button: "Ajouter en alternative",
          })),
        ],
      });
    targets.push({
      group: panel.title,
      items: [
        {
          quote: String(panel.id),
          placement: "end",
          label: panel.sections.length ? "À la suite du devis" : "Dans le devis",
          button: "Ajouter au devis",
        },
        { quote: String(panel.id), placement: "option", label: "En option, hors total", button: "Ajouter en option" },
      ],
    });
  }
  const others = quotes.filter((q) => !panel || q.id !== panel.id);
  targets.push({
    group: panel ? "Autres devis" : "Devis",
    items: [
      ...others.map((q) => ({
        quote: String(q.id),
        placement: "end",
        label: `${q.title}${q.customer ? ` · ${q.customer}` : ""} (${q.number})`,
        button: "Ajouter au devis",
      })),
      { quote: "new", placement: "end", label: "Nouveau devis", button: "Créer un devis avec ce produit" },
    ],
  });
  const key = (t: { quote: string; placement: string }) => `${t.quote}|${t.placement}`;
  const all = targets.flatMap((g) => g.items);
  const chosen =
    all.find((t) => t.quote === quoteId && t.placement === (inPanel ? placement : "end")) ||
    all[0];

  return (
    <main className="workspace product-page">
      <nav className="breadcrumb" aria-label="Fil d'Ariane">
        <Link to="/app/catalogue">Catalogue</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/app/catalogue?marque=${encodeURIComponent(product.vendor)}`}>
          {product.vendor}
        </Link>
        {product.productType && (
          <>
            <span aria-hidden="true">/</span>
            <Link
              to={`/app/catalogue?marque=${encodeURIComponent(product.vendor)}&famille=${encodeURIComponent(product.productType)}`}
            >
              {product.productType}
            </Link>
          </>
        )}
      </nav>
      {demo && <p className="demo-ribbon">Démonstration · catalogue fictif</p>}
      <div className={panel ? "product-layout with-quote" : "product-layout"}>
        <section className="product-gallery" aria-label="Photos">
          <div className="product-photo">
            {photo ? (
              <img src={sized(photo.url, 1200)} alt={photo.alt} />
            ) : (
              <span className="catalogue-nophoto">
                {product.vendor}
                <small>Photo à venir</small>
              </span>
            )}
          </div>
          {images.length > 1 && (
            <div className="product-thumbs">
              {images.map((img, i) => (
                <button
                  key={img.url}
                  type="button"
                  className={photo?.url === img.url ? "active" : ""}
                  aria-pressed={photo?.url === img.url}
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
          <div className="product-titles">
            <span className="product-vendor">
              {product.vendor}
              {product.productType ? ` · ${product.productType}` : ""}
            </span>
            <h1>{product.title}</h1>
          </div>
          {variant && (
            <p className="product-price">
              {money(variant.price)} <small>HTVA · prix public</small>
            </p>
          )}
          {axes.map((axis) => {
            const open = allValues.includes(axis.name);
            const values = open || axis.values.length <= 12 ? axis.values : axis.values.slice(0, 11);
            const sel = current(axis.name);
            const visible = values.includes(sel) ? values : [...values, sel];
            return (
              <fieldset key={axis.name} className="product-option">
                <legend>
                  {axis.name} · <strong>{sel}</strong>
                  {axis.values.length > 6 && (
                    <span className="muted"> {axis.values.length} choix</span>
                  )}
                </legend>
                <div className="product-values">
                  {visible.map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={value === sel}
                      className={match(axis.name, value) ? "" : "unavailable"}
                      title={match(axis.name, value) ? undefined : "Pas avec ce choix : l'autre option changera"}
                      onClick={() => pick(axis.name, value)}
                    >
                      {value}
                    </button>
                  ))}
                  {visible.length < axis.values.length && (
                    <button
                      type="button"
                      className="more"
                      onClick={() => setAllValues([...allValues, axis.name])}
                    >
                      + {axis.values.length - visible.length}
                    </button>
                  )}
                </div>
              </fieldset>
            );
          })}
          <Form method="post" className="product-add">
            <input type="hidden" name="variant" value={variant?.id} />
            <input type="hidden" name="quote" value={chosen.quote} />
            <input type="hidden" name="placement" value={chosen.placement} />
            <label>
              Ajouter à
              <select
                value={key(chosen)}
                onChange={(e) => {
                  const [q, pl] = e.target.value.split("|");
                  setQuoteId(q);
                  setPlacement(pl);
                }}
              >
                {targets.map((g) => (
                  <optgroup key={g.group} label={g.group}>
                    {g.items.map((t) => (
                      <option key={key(t)} value={key(t)}>
                        {t.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <div className="product-add-row">
              <div className="stepper" role="group" aria-label="Quantité">
                <button type="button" aria-label="Moins" onClick={() => setQty(Math.max(1, qty - 1))}>
                  −
                </button>
                <input
                  name="qty"
                  type="number"
                  inputMode="numeric"
                  aria-label="Quantité"
                  min={1}
                  max={10000}
                  value={qty}
                  onChange={(e) => setQty(Math.min(10000, Math.max(1, Number(e.target.value) || 1)))}
                  required
                />
                <button type="button" aria-label="Plus" onClick={() => setQty(Math.min(10000, qty + 1))}>
                  +
                </button>
              </div>
              <button className="primary" disabled={busy || !variant}>
                {chosen.button}
              </button>
            </div>
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
          {product.description && (
            <div className="product-description">
              {product.description.split(/\n+/).map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>
          )}
          {variant?.sku && <p className="product-ref">Référence {variant.sku}</p>}
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
