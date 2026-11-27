import {
  Link,
  useFetcher,
  useLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { context, requireAdmin } from "../services/context.server";
import {
  invoiceQueue,
  markInvoiced,
  remindOverdue,
} from "../services/decision.server";
import { readForm } from "../services/form.server";
import { money } from "../domain/quote";

export const meta = () => [{ title: "À facturer · Mikado Deco Pro" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const c = await context(request);
  requireAdmin(c);
  // Les rappels de 48 h partent aussi à l'ouverture de cette page.
  await remindOverdue().catch((e) => console.error("[rappels]", e));
  return { rows: await invoiceQueue(c.shop) };
}

export async function action({ request }: ActionFunctionArgs) {
  const c = await context(request);
  requireAdmin(c);
  const form = await readForm(request);
  try {
    await markInvoiced(
      c.shop,
      Number(form.get("id")),
      c.user?.id ?? null,
      String(form.get("dueDate") || ""),
    );
    return { ok: "Noté comme facturé." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Action impossible." };
  }
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-BE", { timeZone: "Europe/Brussels" });

type Row = Awaited<ReturnType<typeof invoiceQueue>>[number];

function InvoiceForm({ row }: { row: Row }) {
  const f = useFetcher<{ ok?: string; error?: string }>();
  const in30 = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
  return (
    <f.Form method="post" className="invoice-form">
      <input type="hidden" name="id" value={row.id} />
      <label>
        Échéance
        <input type="date" name="dueDate" defaultValue={in30} required />
      </label>
      <button className="primary" disabled={f.state !== "idle"}>
        Facturé
      </button>
      {f.data?.error && <span className="error">{f.data.error}</span>}
    </f.Form>
  );
}

function Amount({ row }: { row: Row }) {
  const b = row.billing;
  if (!b) return <span className="muted">Après contresignature</span>;
  const gross = b.gross ?? (b.kind === "direct" ? row.clientGross : null);
  if (b.kind !== "architect")
    return (
      <span className="invoice-amount">
        <strong>{money(b.net)} HTVA</strong>
        {gross !== null && <small>{money(gross)} TVAC</small>}
      </span>
    );
  return (
    <span className="invoice-amount">
      <strong>{money(b.net)} HTVA</strong>
      <small>
        Marchandise publique {money(b.merchandisePublic!)}, prix pro − {b.discount} %
        {b.className ? ` (${b.className})` : ""} ligne par ligne :{" "}
        {money(b.merchandisePro!)}
        {b.delivery ? ` · livraison ${b.deliveryPercent} % : ${money(b.delivery)}` : ""}
        {gross !== null ? ` · ${money(gross)} TVAC` : ""}
      </small>
    </span>
  );
}

export default function ToInvoice() {
  const { rows } = useLoaderData<typeof loader>();
  const groups = [
    {
      key: "signed",
      title: "À facturer",
      help: "Contresignés par l'architecte. Fixez l'échéance une fois la facture faite.",
      rows: rows.filter((r) => r.status === "signed"),
    },
    {
      key: "accepted",
      title: "En attente de contresignature",
      help: "Le client a accepté ; l'architecte a 48 h pour contresigner. Rien n'est facturé avant.",
      rows: rows.filter((r) => r.status === "accepted"),
    },
    {
      key: "invoiced",
      title: "Facturés ces 30 derniers jours",
      help: "",
      rows: rows.filter((r) => r.status === "invoiced"),
    },
  ];
  return (
    <main className="workspace invoice-page">
      <header className="page-head">
        <h1>À facturer</h1>
        <p className="muted">
          Les propositions acceptées en ligne par les clients des architectes.
          Mikado Deco facture l'architecte au prix pro.
        </p>
      </header>
      {groups.map((g) => (
        <section key={g.key} className="list-card invoice-group">
          <div className="invoice-group-head">
            <h2>
              {g.title} <span className="muted">· {g.rows.length}</span>
            </h2>
            {g.help && <p className="muted">{g.help}</p>}
          </div>
          {g.rows.length === 0 ? (
            <p className="muted invoice-empty">Rien pour l'instant.</p>
          ) : (
            <ul className="invoice-list">
              {g.rows.map((r) => (
                <li key={r.id} className={r.late ? "is-late" : undefined}>
                  <div className="invoice-what">
                    <Link to={`/app/quotes/${r.quoteId}`}>
                      {r.number} · {r.project}
                    </Link>
                    <span className="muted">
                      {r.firm} · client {r.client} · accepté le {day(r.acceptedAt)}
                      {r.architectSignedAt && ` · contresigné le ${day(r.architectSignedAt)}`}
                    </span>
                    {r.late && (
                      <span className="notice">
                        Délai de 48 h dépassé le {day(r.deadline)}
                      </span>
                    )}
                  </div>
                  <Amount row={r} />
                  {r.status === "signed" && <InvoiceForm row={r} />}
                  {r.status === "invoiced" && r.dueDate && (
                    <span className="muted">Échéance le {day(r.dueDate)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </main>
  );
}
