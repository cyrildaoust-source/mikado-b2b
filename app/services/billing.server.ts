import db from "../db.server";
import { getQuote } from "./quotes.server";
import { fiscalTotals, quoteSchema } from "../domain/quote";
import {
  invoiceFields,
  odooConfigured,
  odooId,
  odooRpc,
  type Invoice,
  type OdooRpc,
} from "./odoo.server";

export function billingMode(shop: string): "disabled" | "simulation" | "live" {
  if (shop === "demo.local")
    return process.env.NODE_ENV !== "production" ? "simulation" : "disabled";
  return process.env.ODOO_AUTOMATION_ENABLED === "true" &&
    process.env.ODOO_LEGACY_GUARD_CONFIRMED === "true" &&
    process.env.ODOO_SHOP === shop &&
    odooConfigured()
    ? "live"
    : "disabled";
}
export async function requestBilling(
  shop: string,
  id: number,
  kind: "deposit" | "balance",
) {
  if (billingMode(shop) === "disabled")
    throw Error(
      "Le connecteur Odoo n’est pas encore activé pour cette boutique.",
    );
  return db.$transaction(async (tx) => {
    const q = await tx.quote.findFirst({
      where: { id, shop },
      include: { conversion: true, billingRequests: true },
    });
    if (
      !q ||
      q.status !== "converted" ||
      !q.conversion?.orderId ||
      q.conversion.orderStatus !== "complete"
    )
      throw Error("Confirmez d’abord le devis et sa commande.");
    const existing = q.billingRequests.find((x) => x.kind === kind);
    if (existing) return existing;
    const s = quoteSchema.parse(JSON.parse(q.state)),
      t = fiscalTotals(s);
    if (kind === "balance" && s.payment === "installments")
      throw Error(
        "L’échéancier 30/50/20 nécessite deux factures distinctes après l’acompte. Configurez d’abord les échéances 50 % et 20 % dans le connecteur Odoo.",
      );
    if (
      s.taxPolicy !== "BE21" ||
      !t.complete ||
      (s.billingSame ? s.shipping : s.billing).countryCode !== "BE"
    )
      throw Error(
        "Ce premier connecteur traite les devis belges en EUR à 21 % uniquement.",
      );
    if (
      kind === "balance" &&
      q.billingRequests.some(
        (x) => x.status !== "linked" || x.invoiceState !== "posted" || x.error,
      )
    )
      throw Error(
        "Validez et vérifiez la facture d’acompte dans Odoo avant de demander le solde.",
      );
    const alreadyRequested = q.billingRequests.reduce(
      (n, x) => n + x.amount,
      0,
    );
    if (
      kind === "balance" &&
      t.deposit &&
      !q.billingRequests.some((x) => x.kind === "deposit")
    )
      throw Error("Demandez d’abord le brouillon d’acompte prévu au devis.");
    const amount =
      kind === "deposit"
        ? t.deposit
        : t.gross - q.billingRequests.reduce((n, x) => n + x.amount, 0);
    if (
      amount === null ||
      amount <= 0 ||
      !Number.isSafeInteger(amount) ||
      amount + alreadyRequested > t.gross
    )
      throw Error(
        "Montant de facture invalide. Vérifiez les modalités de paiement.",
      );
    return tx.billingRequest.create({ data: { quoteId: id, kind, amount } });
  });
}
export async function simulateBilling(shop: string, id: number, stage: string) {
  if (billingMode(shop) !== "simulation")
    throw Error("Simulation disponible uniquement en démonstration locale.");
  const q = await getQuote(shop, id);
  if (!["draft", "posted", "paid"].includes(stage))
    throw Error("Étape inconnue.");
  for (const r of q.billingRequests) {
    if (
      stage === "draft"
        ? r.status !== "queued"
        : r.status !== "linked" ||
          (stage === "posted"
            ? r.invoiceState !== "draft"
            : r.invoiceState !== "posted")
    )
      continue;
    await db.billingRequest.update({
      where: { id: r.id },
      data: {
        status: "linked",
        invoiceId:
          r.invoiceId || r.quoteId * 100 + (r.kind === "deposit" ? 1 : 2),
        invoiceNumber: `SIMULATION-${r.kind}`,
        invoiceState: stage === "draft" ? "draft" : "posted",
        paymentState: stage === "paid" ? "paid" : "not_paid",
        residual: stage === "paid" ? 0 : r.amount,
        syncedAt: new Date(),
        error: null,
      },
    });
  }
}
const keyFor = (id: string) => `mikado-billing:${id}`;
const cents = (n: number) => Math.round(n * 100);
export async function processBilling(
  requestId: string,
  rpc: OdooRpc = odooRpc,
) {
  const r = await db.billingRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { quote: { include: { conversion: true } } },
  });
  if (billingMode(r.quote.shop) !== "live")
    throw Error("Automatisation désactivée.");
  if (
    ["checking", "creating"].includes(r.status) &&
    Date.now() - r.updatedAt.getTime() < 15 * 60 * 1000
  )
    return;
  const company = odooId("ODOO_COMPANY_ID"),
    key = keyFor(r.id);
  const context = { allowed_company_ids: [company] };
  const find = async () =>
    rpc<Invoice[]>(
      "account.move",
      "search_read",
      [
        [
          ["ref", "=", key],
          ["company_id", "=", company],
          ["move_type", "=", "out_invoice"],
        ],
      ],
      { fields: invoiceFields, limit: 2, context },
    );
  const save = async (invoice: Invoice) => {
    const credits = await rpc<{ id: number }[]>(
      "account.move",
      "search_read",
      [
        [
          ["reversed_entry_id", "=", invoice.id],
          ["state", "!=", "cancel"],
          ["company_id", "=", company],
        ],
      ],
      { fields: ["id"], limit: 1, context },
    );
    const mismatch =
      cents(invoice.amount_total) !== r.amount ||
      invoice.currency_id?.[1] !== r.currency ||
      invoice.company_id?.[0] !== company ||
      invoice.ref !== key;
    const issue = mismatch
      ? "Montants ou devise Odoo différents : vérifiez la facture."
      : invoice.state === "cancel" ||
          credits.length ||
          invoice.payment_state === "reversed"
        ? "Facture annulée ou avoir détecté : vérification nécessaire."
        : null;
    await db.billingRequest.update({
      where: { id: r.id },
      data: {
        status: "linked",
        invoiceId: invoice.id,
        invoiceNumber: invoice.name || null,
        invoiceState: invoice.state,
        paymentState: invoice.payment_state,
        residual: cents(invoice.amount_residual),
        syncedAt: new Date(),
        error: issue,
      },
    });
  };
  try {
    if (r.status !== "queued") {
      const found = await find();
      if (found.length !== 1)
        throw Error(
          found.length
            ? "Plusieurs factures correspondent à la demande."
            : "Aucune facture retrouvée. Aucune recréation automatique : contrôle opérateur requis.",
        );
      if (r.invoiceId && found[0].id !== r.invoiceId)
        throw Error("L’identifiant de la facture Odoo a changé.");
      await save(found[0]);
      return;
    }
    const claimed = await db.billingRequest.updateMany({
      where: { id: r.id, status: "queued" },
      data: { status: "checking", error: null },
    });
    if (claimed.count !== 1) return;
    if (r.quote.status !== "converted")
      throw Error("Devis archivé : demande de facture suspendue.");
    const found = await find();
    if (found.length > 1)
      throw Error("Plusieurs factures correspondent à cette demande.");
    if (found.length === 1) {
      await save(found[0]);
      return;
    }
    const s = quoteSchema.parse(JSON.parse(r.quote.state));
    const vat = s.customerVat.replace(/\s/g, "").toUpperCase();
    if (!vat && !s.email)
      throw Error(
        "Renseignez la TVA ou l’e-mail du client pour le retrouver dans Odoo.",
      );
    const partners = await rpc<{ id: number; vat: string | false }[]>(
      "res.partner",
      "search_read",
      [
        [
          [vat ? "vat" : "email", "=ilike", vat || s.email],
          "|",
          ["company_id", "=", false],
          ["company_id", "=", company],
        ],
      ],
      { fields: ["id", "vat"], limit: 2, context },
    );
    if (partners.length !== 1)
      throw Error(
        "Client Odoo absent ou ambigu : vérifiez sa TVA et son e-mail. Aucun client n’a été créé automatiquement.",
      );
    const journal = odooId("ODOO_JOURNAL_ID"),
      account = odooId("ODOO_ACCOUNT_ID"),
      tax = odooId("ODOO_TAX_ID");
    const taxes = await rpc<
      {
        amount: number;
        amount_type: string;
        price_include: boolean;
        type_tax_use: string;
        company_id: [number, string];
        active: boolean;
      }[]
    >("account.tax", "read", [[tax]], {
      fields: [
        "amount",
        "amount_type",
        "price_include",
        "type_tax_use",
        "company_id",
        "active",
      ],
      context,
    });
    if (
      taxes.length !== 1 ||
      taxes[0].amount !== 21 ||
      taxes[0].amount_type !== "percent" ||
      taxes[0].price_include ||
      taxes[0].type_tax_use !== "sale" ||
      taxes[0].company_id[0] !== company ||
      !taxes[0].active
    )
      throw Error(
        "Configurez une TVA Odoo de vente à 21 %, hors prix, pour la bonne société.",
      );
    const companies = await rpc<{ currency_id: [number, string] }[]>(
      "res.company",
      "read",
      [[company]],
      { fields: ["currency_id"], context },
    );
    if (companies[0]?.currency_id[1] !== "EUR")
      throw Error("La société Odoo doit utiliser l’euro.");
    const journals = await rpc<
      { type: string; company_id: [number, string] }[]
    >("account.journal", "read", [[journal]], {
      fields: ["type", "company_id"],
      context,
    });
    if (journals[0]?.type !== "sale" || journals[0]?.company_id[0] !== company)
      throw Error("Journal de vente Odoo incorrect.");
    const others = await rpc<{ ref: string }[]>(
      "account.move",
      "search_read",
      [
        [
          "|",
          ["invoice_origin", "=", `Shopify ${r.quote.conversion!.orderName}`],
          [
            "invoice_origin",
            "=like",
            `Shopify ${r.quote.conversion!.orderName} (%`,
          ],
          ["company_id", "=", company],
          ["state", "!=", "cancel"],
          ["move_type", "=", "out_invoice"],
        ],
      ],
      { fields: ["ref"], limit: 100, context },
    );
    const siblings = await db.billingRequest.findMany({
      where: { quoteId: r.quoteId },
    });
    if (
      others.length >= 100 ||
      others.some((x) => !siblings.some((y) => keyFor(y.id) === x.ref))
    )
      throw Error(
        "Une facture existe déjà pour cette commande hors de ce circuit. Rapprochement manuel nécessaire.",
      );
    const label = `${r.kind === "deposit" ? "Acompte" : "Solde"} — ${r.quote.number} — ${r.quote.title}`;
    // Preserve more than two decimal places in the tax-exclusive unit price. Odoo rounds the invoice totals.
    const net = Number((r.amount / 121).toFixed(6));
    await db.billingRequest.update({
      where: { id: r.id },
      data: { status: "creating" },
    });
    const invoiceId = await rpc<number>(
      "account.move",
      "create",
      [
        {
          move_type: "out_invoice",
          company_id: company,
          partner_id: partners[0].id,
          journal_id: journal,
          currency_id: companies[0].currency_id[0],
          ref: key,
          invoice_origin: `Shopify ${r.quote.conversion!.orderName}`,
          invoice_line_ids: [
            [
              0,
              0,
              {
                name: label,
                quantity: 1,
                price_unit: net,
                account_id: account,
                tax_ids: [[6, 0, [tax]]],
              },
            ],
          ],
        },
      ],
      { context },
    );
    await db.billingRequest.update({
      where: { id: r.id },
      data: { invoiceId, status: "linked" },
    });
    const invoices = await rpc<Invoice[]>(
      "account.move",
      "read",
      [[invoiceId]],
      { fields: invoiceFields, context },
    );
    if (invoices.length !== 1)
      throw Error("Facture créée mais lecture impossible.");
    await save(invoices[0]);
  } catch (error) {
    const current = await db.billingRequest.findUniqueOrThrow({
      where: { id: r.id },
    });
    await db.billingRequest.update({
      where: { id: r.id },
      data: {
        status: current.invoiceId
          ? "linked"
          : ["creating", "uncertain"].includes(current.status)
            ? "uncertain"
            : "error",
        error: error instanceof Error ? error.message : "Échec Odoo",
      },
    });
  }
}
export async function retryBilling(
  shop: string,
  id: number,
  requestId: string,
) {
  await getQuote(shop, id);
  // Only failures known to have happened BEFORE creation can be resubmitted.
  const result = await db.billingRequest.updateMany({
    where: { id: requestId, quoteId: id, status: "error", invoiceId: null },
    data: { status: "queued", error: null },
  });
  if (!result.count)
    throw Error(
      "Cette demande doit être vérifiée avant toute nouvelle tentative.",
    );
}
