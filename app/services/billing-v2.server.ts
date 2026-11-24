import db from "../db.server";
import { getQuote } from "./quotes.server";
import { fiscalTotals, quoteSchema, type QuoteState } from "../domain/quote";
import {
  billingKindLabel,
  billingInvoiceLines,
  billingKinds,
  billingMilestones,
  type BillingKind,
} from "../domain/billing";
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

const normalizeVat = (value: string | false | null | undefined) =>
  String(value || "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();

const brusselsDate = () => {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};

type OdooSetup = {
  company: number;
  journal: number;
  account: number;
  tax: number;
  currency: number;
  partner: number | null;
  partnerWillBeCreated: boolean;
};

async function resolveOdooSetup(
  state: QuoteState,
  rpc: OdooRpc,
  createMissingPartner = false,
): Promise<OdooSetup> {
  const company = odooId("ODOO_COMPANY_ID"),
    journal = odooId("ODOO_JOURNAL_ID"),
    account = odooId("ODOO_ACCOUNT_ID"),
    tax = odooId("ODOO_TAX_ID"),
    context = { allowed_company_ids: [company] };
  const billing = state.billingSame ? state.shipping : state.billing;
  if (!normalizeVat(state.customerVat))
    throw Error(
      "Renseignez le numéro de TVA du client sur le devis avant la facturation Odoo.",
    );
  if (
    state.taxPolicy !== "BE21" ||
    !fiscalTotals(state).complete ||
    billing.countryCode !== "BE"
  )
    throw Error(
      "Le connecteur Odoo traite actuellement les devis belges en EUR à 21 % uniquement.",
    );

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
    throw Error("La taxe Odoo configurée n’est pas la TVA belge de vente à 21 %.");

  const companies = await rpc<{ currency_id: [number, string] }[]>(
    "res.company",
    "read",
    [[company]],
    { fields: ["currency_id"], context },
  );
  if (companies.length !== 1 || companies[0].currency_id[1] !== "EUR")
    throw Error("La société Odoo doit utiliser l’euro.");
  const journals = await rpc<
    { type: string; code: string; company_id: [number, string] }[]
  >("account.journal", "read", [[journal]], {
    fields: ["type", "code", "company_id"],
    context,
  });
  if (
    journals.length !== 1 ||
    journals[0].type !== "sale" ||
    journals[0].code !== "INV" ||
    journals[0].company_id[0] !== company
  )
    throw Error("Le journal de vente Odoo INV est mal configuré.");
  const accounts = await rpc<
    { code: string }[]
  >("account.account", "read", [[account]], {
    fields: ["code"],
    context,
  });
  if (accounts.length !== 1 || accounts[0].code !== "700000")
    throw Error("Le compte de produits Odoo 700000 est mal configuré.");

  type Partner = {
    id: number;
    vat: string | false;
    email: string | false;
    name: string;
  };
  const fields = ["id", "vat", "email", "name"];
  const vat = normalizeVat(state.customerVat);
  const byVat = vat
    ? await rpc<Partner[]>(
        "res.partner",
        "search_read",
        [[["vat", "=ilike", vat]]],
        { fields, limit: 2, context },
      )
    : [];
  const byEmail = state.email
    ? await rpc<Partner[]>(
        "res.partner",
        "search_read",
        [[["email", "=ilike", state.email.trim()]]],
        { fields, limit: 2, context },
      )
    : [];
  if (byVat.length > 1 || byEmail.length > 1)
    throw Error(
      "Plusieurs clients Odoo correspondent à la TVA ou à l’e-mail. Vérifiez la fiche client.",
    );
  if (byVat[0] && byEmail[0] && byVat[0].id !== byEmail[0].id)
    throw Error(
      "La TVA et l’e-mail correspondent à deux clients Odoo différents. Aucun brouillon n’a été créé.",
    );
  let partner = byVat[0] || byEmail[0];
  if (!partner) {
    const names = [...new Set([billing.company.trim(), state.client.trim()])].filter(
      Boolean,
    );
    for (const name of names) {
      const matches = await rpc<Partner[]>(
        "res.partner",
        "search_read",
        [[["name", "=ilike", name]]],
        { fields, limit: 2, context },
      );
      if (matches.length > 1)
        throw Error(
          "Plusieurs clients Odoo portent ce nom. Renseignez une TVA ou un e-mail unique.",
        );
      if (matches.length === 1) {
        partner = matches[0];
        break;
      }
    }
  }
  let partnerWillBeCreated = false;
  if (!partner) {
    const name = billing.company.trim() || state.client.trim();
    if (!name)
      throw Error("Le nom de facturation est requis pour créer le client Odoo.");
    const countries = await rpc<{ id: number; code: string }[]>(
      "res.country",
      "search_read",
      [[["code", "=", billing.countryCode]]],
      { fields: ["id", "code"], limit: 2, context },
    );
    if (countries.length !== 1)
      throw Error("Le pays de facturation ne peut pas être identifié dans Odoo.");
    partnerWillBeCreated = true;
    if (createMissingPartner) {
      const partnerId = await rpc<number>(
        "res.partner",
        "create",
        [
          {
            name,
            is_company: true,
            company_type: "company",
            customer_rank: 1,
            vat,
            email: state.email.trim() || false,
            street: billing.address1.trim() || false,
            street2: billing.address2.trim() || false,
            zip: billing.zip.trim() || false,
            city: billing.city.trim() || false,
            country_id: countries[0].id,
            company_id: company,
          },
        ],
        { context },
      );
      if (!Number.isSafeInteger(partnerId) || partnerId <= 0)
        throw Error("La création automatique du client Odoo a échoué.");
      const created = await rpc<Partner[]>("res.partner", "read", [[partnerId]], {
        fields,
        context,
      });
      if (
        created.length !== 1 ||
        normalizeVat(created[0].vat) !== vat ||
        created[0].name.trim() !== name
      )
        throw Error(
          "Le client Odoo a été créé mais ses données ne correspondent pas au devis.",
        );
      partner = created[0];
      partnerWillBeCreated = false;
    }
  }
  const partnerVat = normalizeVat(partner?.vat);
  if (partner && vat && !partnerVat)
    throw Error(
      "Le client existe dans Odoo mais son numéro de TVA est vide. Complétez sa fiche avant de créer le brouillon.",
    );
  if (partner && vat && partnerVat && vat !== partnerVat)
    throw Error(
      "La TVA du client diffère dans Shopify et Odoo. Aucun brouillon n’a été créé.",
    );
  return {
    company,
    journal,
    account,
    tax,
    currency: companies[0].currency_id[0],
    partner: partner?.id || null,
    partnerWillBeCreated,
  };
}

export async function preflightBilling(
  shop: string,
  id: number,
  rpc: OdooRpc = odooRpc,
) {
  if (billingMode(shop) === "disabled")
    throw Error("Le connecteur Odoo n’est pas activé pour cette boutique.");
  const quote = await getQuote(shop, id);
  const state = quoteSchema.parse(JSON.parse(quote.state));
  const milestones = billingMilestones(state);
  if (!milestones.length)
    throw Error(
      "Choisissez des modalités de paiement avec un acompte avant de confirmer le devis.",
    );
  if (billingMode(shop) === "live") await resolveOdooSetup(state, rpc);
  return milestones;
}

export async function requestBilling(
  shop: string,
  id: number,
  kind: BillingKind,
  actor: string | null = null,
  milestoneConfirmed = false,
) {
  if (!billingKinds.includes(kind)) throw Error("Échéance inconnue.");
  if (billingMode(shop) === "disabled")
    throw Error("Le connecteur Odoo n’est pas activé pour cette boutique.");
  return db.$transaction(async (tx) => {
    const quote = await tx.quote.findFirst({
      where: { id, shop },
      include: { conversion: true, billingRequests: true },
    });
    if (
      !quote ||
      quote.status !== "converted" ||
      !quote.conversion?.orderId ||
      quote.conversion.orderStatus !== "complete"
    )
      throw Error("Confirmez d’abord le devis et sa commande Shopify.");
    const existing = quote.billingRequests.find((request) => request.kind === kind);
    if (existing) return existing;
    const state = quoteSchema.parse(JSON.parse(quote.state));
    const milestones = billingMilestones(state);
    const index = milestones.findIndex((milestone) => milestone.kind === kind);
    if (index < 0)
      throw Error("Cette échéance ne correspond pas aux modalités du devis.");
    const milestone = milestones[index];
    if (milestone.requiresDeliveryConfirmation && !milestoneConfirmed)
      throw Error("Confirmez que la livraison a eu lieu avant de préparer le solde.");
    for (const prerequisite of milestones.slice(0, index)) {
      const previous = quote.billingRequests.find(
        (candidate) => candidate.kind === prerequisite.kind,
      );
      if (
        !previous ||
        previous.status !== "linked" ||
        previous.invoiceState !== "posted" ||
        previous.error
      )
        throw Error(
          `Validez d’abord la facture « ${prerequisite.label} » dans Odoo et actualisez son état.`,
        );
    }
    return tx.billingRequest.create({
      data: {
        quoteId: id,
        kind,
        amount: milestone.amount,
        netAmount: milestone.net,
        taxAmount: milestone.tax,
        authorizedBy: actor,
        milestoneConfirmedAt: milestoneConfirmed ? new Date() : null,
      },
    });
  });
}

export async function simulateBilling(shop: string, id: number, stage: string) {
  if (billingMode(shop) !== "simulation")
    throw Error("Simulation disponible uniquement en démonstration locale.");
  const quote = await getQuote(shop, id);
  if (!["draft", "posted", "paid"].includes(stage))
    throw Error("Étape inconnue.");
  for (const [index, request] of quote.billingRequests.entries()) {
    if (
      stage === "draft"
        ? request.status !== "queued"
        : request.status !== "linked" ||
          (stage === "posted"
            ? request.invoiceState !== "draft"
            : request.invoiceState !== "posted")
    )
      continue;
    await db.billingRequest.update({
      where: { id: request.id },
      data: {
        status: "linked",
        invoiceId: request.invoiceId || request.quoteId * 100 + index + 1,
        invoiceNumber: `SIMULATION-${request.kind}`,
        invoiceState: stage === "draft" ? "draft" : "posted",
        paymentState: stage === "paid" ? "paid" : "not_paid",
        residual: stage === "paid" ? 0 : request.amount,
        syncedAt: new Date(),
        error: null,
      },
    });
  }
}

const keyFor = (number: string | null, quoteId: number, kind: string) =>
  `mikado:${number || quoteId}:${kind}`;
const originFor = (number: string | null, orderName: string, kind: string) =>
  `Shopify ${orderName} (Mikado Devis ${number || ""} / ${kind})`;
const paymentReferenceFor = (
  number: string | null,
  quoteId: number,
  kind: string,
) => `${billingKindLabel(kind)} devis ${number || quoteId}`;
const cents = (value: number) => Math.round(value * 100);

export async function processBilling(
  requestId: string,
  rpc: OdooRpc = odooRpc,
) {
  const request = await db.billingRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { quote: { include: { conversion: true } } },
  });
  if (billingMode(request.quote.shop) !== "live")
    throw Error("Automatisation désactivée.");
  if (
    ["checking", "creating"].includes(request.status) &&
    Date.now() - request.updatedAt.getTime() < 15 * 60 * 1000
  )
    return;
  const state = quoteSchema.parse(JSON.parse(request.quote.state));
  const milestone = billingMilestones(state).find(
    (candidate) => candidate.kind === request.kind,
  );
  if (!milestone) throw Error("Échéance absente du devis.");
  const expectedNet = request.netAmount ?? milestone.net;
  const expectedTax = request.taxAmount ?? milestone.tax;
  const plannedLines = billingInvoiceLines(state, milestone);
  const key = keyFor(request.quote.number, request.quoteId, request.kind);
  const origin = originFor(
    request.quote.number,
    request.quote.conversion!.orderName!,
    request.kind,
  );
  const paymentReference = paymentReferenceFor(
    request.quote.number,
    request.quoteId,
    request.kind,
  );
  try {
    const setup = await resolveOdooSetup(state, rpc, true);
    if (!setup.partner)
      throw Error("Le client Odoo n’a pas pu être créé ou rapproché.");
    const context = { allowed_company_ids: [setup.company] };
    const find = () =>
      rpc<Invoice[]>(
        "account.move",
        "search_read",
        [
          [
            ["ref", "=", key],
            ["company_id", "=", setup.company],
            ["move_type", "=", "out_invoice"],
          ],
        ],
        { fields: invoiceFields, limit: 2, context },
      );
    const save = async (invoice: Invoice) => {
      if (
        invoice.state === "draft" &&
        invoice.payment_reference !== paymentReference
      ) {
        const updated = await rpc<boolean>(
          "account.move",
          "write",
          [[invoice.id], { payment_reference: paymentReference }],
          { context },
        );
        if (!updated)
          throw Error("La communication de paiement Odoo n’a pas pu être ajoutée.");
        const refreshed = await rpc<Invoice[]>(
          "account.move",
          "read",
          [[invoice.id]],
          { fields: invoiceFields, context },
        );
        if (refreshed.length !== 1)
          throw Error("Facture mise à jour mais lecture impossible.");
        invoice = refreshed[0];
      }
      const credits = await rpc<{ id: number }[]>(
        "account.move",
        "search_read",
        [
          [
            ["reversed_entry_id", "=", invoice.id],
            ["state", "!=", "cancel"],
            ["company_id", "=", setup.company],
          ],
        ],
        { fields: ["id"], limit: 1, context },
      );
      const lines = await rpc<
        {
          name: string;
          tax_ids: number[];
          account_id: [number, string];
          price_subtotal: number;
          price_total: number;
        }[]
      >("account.move.line", "read", [invoice.invoice_line_ids || []], {
        fields: [
          "name",
          "tax_ids",
          "account_id",
          "price_subtotal",
          "price_total",
        ],
        context,
      });
      const mismatch =
        cents(invoice.amount_total) !== request.amount ||
        cents(invoice.amount_untaxed) !== expectedNet ||
        cents(invoice.amount_tax) !== expectedTax ||
        invoice.currency_id?.[1] !== request.currency ||
        invoice.company_id?.[0] !== setup.company ||
        invoice.partner_id?.[0] !== setup.partner ||
        invoice.ref !== key ||
        invoice.payment_reference !== paymentReference ||
        invoice.invoice_origin !== origin ||
        lines.length !== plannedLines.length ||
        lines.some(
          (line, index) =>
            !line.tax_ids.includes(setup.tax) ||
            line.account_id?.[0] !== setup.account ||
            line.name !== plannedLines[index]?.name ||
            cents(line.price_subtotal) !== plannedLines[index]?.net ||
            cents(line.price_total) !==
              plannedLines[index]?.net + plannedLines[index]?.tax,
        );
      const issue = mismatch
        ? "Le client, les taxes ou les montants Odoo diffèrent du devis. Vérifiez le brouillon."
        : invoice.state === "cancel" ||
            credits.length ||
            invoice.payment_state === "reversed"
          ? "Facture annulée ou avoir détecté : vérification nécessaire."
          : null;
      await db.billingRequest.update({
        where: { id: request.id },
        data: {
          status: "linked",
          partnerId: setup.partner,
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

    if (request.status !== "queued") {
      const found = await find();
      if (found.length !== 1)
        throw Error(
          found.length
            ? "Plusieurs factures correspondent à cette échéance."
            : "Aucune facture retrouvée. Aucune recréation automatique : contrôle requis.",
        );
      if (request.invoiceId && found[0].id !== request.invoiceId)
        throw Error("L’identifiant de la facture Odoo a changé.");
      await save(found[0]);
      return;
    }

    const claimed = await db.billingRequest.updateMany({
      where: { id: request.id, status: "queued" },
      data: {
        status: "checking",
        partnerId: setup.partner,
        netAmount: expectedNet,
        taxAmount: expectedTax,
        error: null,
      },
    });
    if (claimed.count !== 1) return;
    if (request.quote.status !== "converted")
      throw Error("Devis archivé : demande de facture suspendue.");
    const found = await find();
    if (found.length > 1)
      throw Error("Plusieurs factures correspondent à cette échéance.");
    if (found.length === 1) {
      await save(found[0]);
      return;
    }
    const legacyInvoices = await rpc<{ ref: string }[]>(
      "account.move",
      "search_read",
      [
        [
          "|",
          [
            "invoice_origin",
            "=",
            `Shopify ${request.quote.conversion!.orderName}`,
          ],
          [
            "invoice_origin",
            "=like",
            `Shopify ${request.quote.conversion!.orderName} (%`,
          ],
          ["company_id", "=", setup.company],
          ["move_type", "=", "out_invoice"],
        ],
      ],
      { fields: ["ref"], limit: 100, context },
    );
    const siblings = await db.billingRequest.findMany({
      where: { quoteId: request.quoteId },
    });
    const siblingKeys = new Set(
      siblings.map((sibling) =>
        keyFor(request.quote.number, request.quoteId, sibling.kind),
      ),
    );
    if (
      legacyInvoices.length >= 100 ||
      legacyInvoices.some((invoice) => !siblingKeys.has(invoice.ref))
    )
      throw Error(
        "Une facture existe déjà pour cette commande hors de ce circuit. Rapprochement manuel nécessaire.",
      );
    await db.billingRequest.update({
      where: { id: request.id },
      data: { status: "creating" },
    });
    const invoiceId = await rpc<number>(
      "account.move",
      "create",
      [
        {
          move_type: "out_invoice",
          company_id: setup.company,
          partner_id: setup.partner,
          journal_id: setup.journal,
          currency_id: setup.currency,
          invoice_date: brusselsDate(),
          ref: key,
          payment_reference: paymentReference,
          invoice_origin: origin,
          invoice_line_ids: plannedLines.map((line) => [
            0,
            0,
            {
              name: line.name,
              quantity: 1,
              price_unit: line.net / 100,
              account_id: setup.account,
              tax_ids: [[6, 0, [setup.tax]]],
            },
          ]),
        },
      ],
      { context },
    );
    await db.billingRequest.update({
      where: { id: request.id },
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
      where: { id: request.id },
    });
    await db.billingRequest.update({
      where: { id: request.id },
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
  const result = await db.billingRequest.updateMany({
    where: { id: requestId, quoteId: id, status: "error", invoiceId: null },
    data: { status: "queued", error: null },
  });
  if (!result.count)
    throw Error("Cette demande doit être vérifiée avant toute nouvelle tentative.");
}

export { billingKindLabel };
