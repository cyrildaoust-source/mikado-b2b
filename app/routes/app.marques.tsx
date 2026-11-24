import {
  Form,
  useActionData,
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
        includeDrafts: r?.includeDrafts ?? false,
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
  const visible = form.get("visible") === "on",
    includeDrafts = form.get("includeDrafts") === "on";
  await db.brandSetting.upsert({
    where: { vendor },
    create: { vendor, visible, includeDrafts },
    update: { visible, includeDrafts },
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
              <th>Réglage pour les architectes</th>
            </tr>
          </thead>
          <tbody>
            {brands.map((b) => (
              <tr key={b.vendor}>
                <td>{b.vendor}</td>
                <td>
                  <Form method="post" className="brand-form">
                    <input type="hidden" name="vendor" value={b.vendor} />
                    <label className="inline">
                      <input
                        type="checkbox"
                        name="visible"
                        defaultChecked={b.visible}
                      />{" "}
                      Visible
                    </label>
                    <label className="inline">
                      <input
                        type="checkbox"
                        name="includeDrafts"
                        defaultChecked={b.includeDrafts}
                      />{" "}
                      Brouillons inclus
                    </label>
                    <button>Enregistrer</button>
                  </Form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted brand-note">
          Par défaut, une marque est visible avec ses seules fiches actives.
          Cochez « Brouillons inclus » pour une marque que vous ne vendez pas en
          ligne (par exemple une marque en représentation indirecte) : ses
          fiches en brouillon apparaissent alors aux architectes connectées.
        </p>
      </div>
    </main>
  );
}
