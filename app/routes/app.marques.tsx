import {
  useActionData,
  useFetcher,
  useLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import db from "../db.server";
import { context, requireAdmin } from "../services/context.server";
import { allVendors, brandRules } from "../services/catalog.server";
import { readForm } from "../services/form.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const c = await context(request);
  requireAdmin(c);
  const [vendors, rules] = await Promise.all([
    allVendors(c.admin).catch(() => [] as string[]),
    brandRules(),
  ]);
  const names = [...new Set([...vendors, ...rules.map((r) => r.vendor)])].sort(
    (a, b) => a.localeCompare(b, "fr"),
  );
  return {
    brands: names.map((vendor) => {
      const r = rules.find((x) => x.vendor === vendor);
      return {
        vendor,
        visible: r?.visible ?? true,
      };
    }),
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const c = await context(request);
  requireAdmin(c);
  const form = await readForm(request),
    vendor = String(form.get("vendor") || "").slice(0, 255);
  if (!vendor) return { error: "Marque manquante." };
  const visible = form.get("visible") === "on";
  await db.brandSetting.upsert({
    where: { vendor },
    create: { vendor, visible },
    update: { visible },
  });
  return { ok: `${vendor} : réglage enregistré.` };
}

export default function Brands() {
  const { brands } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  return (
    <main className="workspace">
      <header className="list-header">
        <div>
          <h1>Marques</h1>
          <p>
            Ce que les architectes voient dans le catalogue. Rien n'est modifié
            dans Shopify ni sur le site public.
          </p>
        </div>
      </header>
      {result && "ok" in result && (
        <p role="status" className="success">
          {result.ok}
        </p>
      )}
      {result && "error" in result && (
        <p role="alert" className="error">
          {result.error}
        </p>
      )}
      <div className="list-card">
        <table className="quote-table brand-table">
          <thead>
            <tr>
              <th>Marque</th>
              <th>Catalogue des architectes</th>
            </tr>
          </thead>
          <tbody>
            {brands.map((b) => (
              <tr key={b.vendor}>
                <td>{b.vendor}</td>
                <td>
                  <BrandToggle vendor={b.vendor} visible={b.visible} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted brand-note">
          Toutes les fiches encodées sont visibles, actives ou en brouillon,
          gold ou non. Décochez « Visible » pour retirer une marque du catalogue
          des architectes. Les fiches archivées n'apparaissent jamais.
        </p>
      </div>
    </main>
  );
}

// Un clic sur l'interrupteur enregistre : pas de bouton Enregistrer.
function BrandToggle({
  vendor,
  visible,
}: {
  vendor: string;
  visible: boolean;
}) {
  const fetcher = useFetcher<typeof action>();
  const pending = fetcher.formData
    ? fetcher.formData.get("visible") === "on"
    : undefined;
  const on = pending ?? visible;
  const error =
    fetcher.data && "error" in fetcher.data ? fetcher.data.error : "";
  return (
    <fetcher.Form method="post" className="brand-form">
      <input type="hidden" name="vendor" value={vendor} />
      <label className="switch">
        <input
          type="checkbox"
          role="switch"
          name="visible"
          checked={on}
          aria-label={`${vendor} visible dans le catalogue`}
          onChange={(e) => fetcher.submit(e.currentTarget.form)}
        />
        <span>{on ? "Visible" : "Masquée"}</span>
      </label>
      <span className="brand-state" role="status">
        {fetcher.state !== "idle"
          ? "Enregistrement…"
          : error
            ? error
            : fetcher.data
              ? "Enregistré"
              : ""}
      </span>
    </fetcher.Form>
  );
}
