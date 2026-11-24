import test from "node:test";
import assert from "node:assert/strict";
import db from "../../app/db.server";
import {
  emptyQuote,
  amount,
  quoteSections,
  removeLine,
} from "../../app/domain/quote";
import { demoLines, type Admin } from "../../app/services/shopify-api.server";
import {
  createQuote,
  getQuote,
  saveQuote,
  archiveQuote,
  markSent,
  restoreRevision,
  listQuotes,
  unarchiveQuote,
} from "../../app/services/quotes.server";
import {
  previewConversion,
  publishQuote as publishSnapshot,
  convertQuote,
  reconcile,
} from "../../app/services/conversion.server";
async function publishQuote(
  shop: string,
  id: number,
  version: number,
  admin: Admin,
) {
  await publishSnapshot(shop, id, version, admin);
  // PDF renderer is exercised separately in the browser; simulate its completed persistence here.
  await db.revision.update({
    where: { quoteId_version: { quoteId: id, version } },
    data: { pdfGeneratedAt: new Date(), pdf: Buffer.from("test-pdf") },
  });
}
const shop = `test-${Date.now()}.local`;
function state() {
  const s = emptyQuote();
  s.shipping = {
    ...s.shipping,
    address1: "Rue du Test 1",
    city: "Bruxelles",
    zip: "1000",
  };
  s.groups = [
    {
      id: "g",
      syncQty: true,
      sectionId: "test-section",
      section: "Salle",
      selected: "a",
      items: [{ ...demoLines[0], id: "a" }],
    },
  ];
  return s;
}
function mock(
  failure: "network" | "denied" | null = null,
  netDelta = 0,
  createdDelta = 0,
) {
  let calls = 0,
    created = false;
  const bag = (n: number) => ({
    presentmentMoney: { amount: amount(n), currencyCode: "EUR" },
  });
  const admin: Admin = {
    graphql: async (query, options) => {
      let data;
      if (query.includes("draftOrderCalculate")) {
        const input = options?.variables?.input as {
          lineItems: { uuid: string; quantity: number }[];
        };
        data = {
          draftOrderCalculate: {
            calculatedDraftOrder: {
              totalPriceSet: bag(12100 + netDelta),
              totalTaxSet: bag(2100),
              subtotalPriceSet: bag(10000 + netDelta),
              taxesIncluded: false,
              taxLines: [{ rate: 0.21, priceSet: bag(2100) }],
              lineItems: input.lineItems.map((i) => ({
                ...i,
                discountedTotalSet: bag(10000),
              })),
            },
            userErrors: [],
          },
        };
      } else if (query.includes("draftOrderCreate")) {
        calls++;
        if (failure === "denied") throw new Response("Denied", { status: 403 });
        created = true;
        if (failure === "network") throw Error("connexion interrompue");
        data = {
          draftOrderCreate: {
            draftOrder: {
              id: "gid://shopify/DraftOrder/123",
              name: "#D123",
              totalPriceSet: bag(12100),
            },
            userErrors: [],
          },
        };
      } else if (query.includes("draftOrders"))
        data = {
          draftOrders: {
            nodes: created
              ? [{ id: "gid://shopify/DraftOrder/123", name: "#D123" }]
              : [],
          },
        };
      else if (query.includes("InspectDraft"))
        data = {
          draftOrder: {
            id: "gid://shopify/DraftOrder/123",
            name: "#D123",
            totalPriceSet: bag(12100 + createdDelta),
            totalTaxSet: bag(2100),
            lineItems: {
              nodes: [
                {
                  uuid: "a",
                  quantity: 1,
                  variant: null,
                  discountedTotalSet: bag(10000),
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        };
      else
        data = {
          shop: { name: "Test", currencyCode: "EUR", taxesIncluded: false },
        };
      return Response.json({ data });
    },
  };
  return {
    admin,
    count: () => calls,
    simulateExisting: () => {
      created = true;
    },
  };
}
test("isolation, concurrence, snapshots et archivage", async () => {
  const q = await createQuote(shop, state());
  try {
    await assert.rejects(() => getQuote("other.local", q.id));
    const s = state();
    s.project = "Modifié";
    await saveQuote(shop, q.id, 1, s);
    await assert.rejects(() => saveQuote(shop, q.id, 1, s));
    const r = await db.revision.findUniqueOrThrow({
      where: { quoteId_version: { quoteId: q.id, version: 1 } },
    });
    assert.equal(JSON.parse(r.state).project, "Nouveau projet");
    await archiveQuote(shop, q.id, 2);
    const archived = await getQuote(shop, q.id);
    assert.equal(archived.version, 2);
    assert.equal(archived.status, "archived");
    await assert.rejects(() => saveQuote(shop, q.id, 2, s));
  } finally {
    await db.quote.delete({ where: { id: q.id } });
  }
});

test("suppression du premier article : ordre du lot conservé après sauvegarde", async () => {
  const tenant = `${shop}-remove-first-line`;
  const s = state();
  const baseGroup = s.groups[0];
  s.groups = [
    {
      ...baseGroup,
      id: "relax",
      sectionId: "relax",
      section: "Coin Relax",
      selected: "sofa",
      items: [{ ...baseGroup.items[0], id: "sofa", name: "Canapé" }],
    },
    {
      ...baseGroup,
      id: "meeting-first",
      sectionId: "meeting-room-1",
      section: "Salle de réunion 1",
      selected: "steelcut",
      items: [{ ...baseGroup.items[0], id: "steelcut", name: "Steelcut" }],
    },
    {
      ...baseGroup,
      id: "ceo",
      sectionId: "ceo",
      section: "Bureau CEO",
      selected: "ceo-chair",
      items: [{ ...baseGroup.items[0], id: "ceo-chair", name: "Fauteuil" }],
    },
    {
      ...baseGroup,
      id: "meeting-second",
      sectionId: "meeting-room-1",
      section: "Salle de réunion 1",
      selected: "remix",
      items: [{ ...baseGroup.items[0], id: "remix", name: "Remix 962" }],
    },
  ];
  const q = await createQuote(tenant, s);
  try {
    await saveQuote(tenant, q.id, 1, removeLine(s, "steelcut"));
    const saved = JSON.parse((await getQuote(tenant, q.id)).state);
    const sections = quoteSections(saved);
    assert.deepEqual(
      sections.map((section) => section.title),
      ["Coin Relax", "Salle de réunion 1", "Bureau CEO"],
    );
    assert.equal(sections[1].groups[0].items[0].name, "Remix 962");
  } finally {
    await db.quote.deleteMany({ where: { shop: tenant } });
  }
});
test("révisions commerciales indépendantes des sauvegardes et restauration", async () => {
  const q = await createQuote(shop, state()),
    m = mock();
  try {
    let s = state();
    for (let i = 1; i <= 3; i++) {
      s = { ...s, project: `Projet ${i}` };
      await saveQuote(shop, q.id, i, s);
    }
    await publishQuote(shop, q.id, 4, m.admin);
    await publishQuote(shop, q.id, 4, m.admin);
    let r = (await getQuote(shop, q.id)).revisions.find(
      (r) => r.version === 4,
    )!;
    assert.equal(r.publishedNumber, 1);
    await markSent(shop, q.id, 4);
    await restoreRevision(shop, q.id, 4, 1);
    await publishQuote(shop, q.id, 5, m.admin);
    r = (await getQuote(shop, q.id)).revisions.find((r) => r.version === 5)!;
    assert.equal(r.publishedNumber, 2);
    assert.ok(
      (await getQuote(shop, q.id)).revisions.find((r) => r.version === 4)
        ?.sentAt,
    );
  } finally {
    await db.quote.delete({ where: { id: q.id } });
  }
});
test("une seule création et édition verrouillée après conversion", async () => {
  const q = await createQuote(shop, state()),
    m = mock();
  try {
    await publishQuote(shop, q.id, 1, m.admin);
    await convertQuote(shop, q.id, 1, m.admin);
    await convertQuote(shop, q.id, 1, m.admin);
    assert.equal(m.count(), 1);
    await assert.rejects(() => saveQuote(shop, q.id, 1, state()));
  } finally {
    await db.quote.delete({ where: { id: q.id } });
  }
});
test("réponse incertaine : recherche de la commande sans recréation", async () => {
  const q = await createQuote(shop, state()),
    m = mock("network");
  try {
    await publishQuote(shop, q.id, 1, m.admin);
    await assert.rejects(() => convertQuote(shop, q.id, 1, m.admin));
    await assert.rejects(() => convertQuote(shop, q.id, 1, m.admin));
    assert.equal((await getQuote(shop, q.id)).conversion?.status, "uncertain");
    await reconcile(shop, q.id, m.admin);
    assert.equal((await getQuote(shop, q.id)).conversion?.status, "complete");
    assert.equal(m.count(), 1);
  } finally {
    await db.quote.delete({ where: { id: q.id } });
  }
});
test("refus HTTP explicite ne verrouille pas définitivement", async () => {
  const q = await createQuote(shop, state()),
    m = mock("denied");
  try {
    await publishQuote(shop, q.id, 1, m.admin);
    await assert.rejects(() => convertQuote(shop, q.id, 1, m.admin));
    assert.equal((await getQuote(shop, q.id)).conversion?.status, "rejected");
    await previewConversion(shop, q.id, 1, m.admin);
    assert.equal((await getQuote(shop, q.id)).conversion?.status, "preview");
  } finally {
    await db.quote.delete({ where: { id: q.id } });
  }
});
test("écart HTVA supérieur à l’arrondi bloque publication et création", async () => {
  const q = await createQuote(shop, state()),
    m = mock(null, 2);
  try {
    await assert.rejects(() => publishQuote(shop, q.id, 1, m.admin));
    await assert.rejects(() => convertQuote(shop, q.id, 1, m.admin));
    assert.equal(m.count(), 0);
  } finally {
    await db.quote.delete({ where: { id: q.id } });
  }
});
test("commande préexistante retrouvée après restauration, sans création", async () => {
  const q = await createQuote(shop, state()),
    m = mock();
  try {
    await publishQuote(shop, q.id, 1, m.admin);
    m.simulateExisting();
    await convertQuote(shop, q.id, 1, m.admin);
    assert.equal(m.count(), 0);
    assert.equal((await getQuote(shop, q.id)).conversion?.status, "complete");
  } finally {
    await db.quote.delete({ where: { id: q.id } });
  }
});
test.after(async () => {
  await db.$disconnect();
});

test("écart après création : identifiant conservé et aucune recréation", async () => {
  const q = await createQuote(shop, state()),
    m = mock(null, 0, 1);
  try {
    await publishQuote(shop, q.id, 1, m.admin);
    await assert.rejects(() => convertQuote(shop, q.id, 1, m.admin));
    const current = await getQuote(shop, q.id);
    assert.equal(current.conversion?.status, "uncertain");
    assert.equal(current.conversion?.draftId, "gid://shopify/DraftOrder/123");
    await assert.rejects(() => convertQuote(shop, q.id, 1, m.admin));
    assert.equal(m.count(), 1);
  } finally {
    await db.quote.delete({ where: { id: q.id } });
  }
});
test("publication sans fichier ne permet pas de créer une commande", async () => {
  const q = await createQuote(shop, state()),
    m = mock();
  try {
    await publishSnapshot(shop, q.id, 1, m.admin);
    await assert.rejects(() => convertQuote(shop, q.id, 1, m.admin));
    assert.equal(m.count(), 0);
  } finally {
    await db.quote.delete({ where: { id: q.id } });
  }
});
test("recherche paginée, statut et restauration des archives", async () => {
  const ids: number[] = [];
  try {
    for (let i = 0; i < 27; i++) {
      const q = await createQuote(shop, {
        ...state(),
        project: `Recherche ${i}`,
      });
      ids.push(q.id);
    }
    const first = await listQuotes(shop, "Recherche", "all", 1),
      second = await listQuotes(shop, "Recherche", "all", 2);
    assert.equal(first.total, 27);
    assert.equal(first.quotes.length, 25);
    assert.equal(second.quotes.length, 2);
    assert.equal((await listQuotes("other.local", "Recherche")).total, 0);
    await archiveQuote(shop, ids[0], 1);
    assert.equal((await listQuotes(shop, "Recherche", "archived")).total, 1);
    await unarchiveQuote(shop, ids[0], 1);
    assert.equal((await listQuotes(shop, "Recherche", "all")).total, 27);
    assert.equal((await listQuotes(shop, "%", "all")).total, 0);
  } finally {
    await db.quote.deleteMany({ where: { id: { in: ids } } });
  }
});

test("facturation : acompte, solde, isolation et reprise sans double création", async () => {
  const { requestBilling, processBilling, simulateBilling, retryBilling } =
    await import("../../app/services/billing-v2.server");
  const { acceptOrder } = await import("../../app/services/order.server");
  const configuredShop = `billing-${Date.now()}.local`;
  const vars = {
    ODOO_AUTOMATION_ENABLED: "true",
    ODOO_LEGACY_GUARD_CONFIRMED: "true",
    ODOO_SHOP: configuredShop,
    ODOO_URL: "https://odoo.example",
    ODOO_DB: "test",
    ODOO_LOGIN: "test",
    ODOO_API_KEY: "test",
    ODOO_COMPANY_ID: "1",
    ODOO_JOURNAL_ID: "8",
    ODOO_ACCOUNT_ID: "438",
    ODOO_TAX_ID: "5",
  };
  const previous = Object.fromEntries(
    Object.keys(vars).map((k) => [k, process.env[k]]),
  );
  Object.assign(process.env, vars);
  const make = async (payment: "deposit" | "installments" = "deposit") => {
    const s = state();
    s.payment = payment;
    s.depositPercent = 30;
    s.client = "Client test";
    s.email = "test@example.com";
    s.customerVat = "BE0123456789";
    const q = await createQuote(configuredShop, s);
    await db.quote.update({
      where: { id: q.id },
      data: {
        status: "converted",
        conversion: {
          create: {
            version: 1,
            status: "complete",
            preview: "{}",
            orderId: `gid://shopify/Order/${q.id}`,
            orderName: `#${q.id}`,
            orderStatus: "complete",
          },
        },
      },
    });
    return q;
  };
  try {
    const staged = await make("installments");
    const stagedDeposit = await requestBilling(
      configuredShop,
      staged.id,
      "deposit",
    );
    assert.equal(stagedDeposit.amount, 3630);
    await assert.rejects(
      () => requestBilling(configuredShop, staged.id, "balance"),
      /ne correspond pas/,
    );
    await assert.rejects(
      () => requestBilling(configuredShop, staged.id, "before_delivery"),
      /Validez d’abord/,
    );
    await db.billingRequest.update({
      where: { id: stagedDeposit.id },
      data: {
        status: "linked",
        invoiceState: "posted",
        paymentState: "not_paid",
        error: null,
      },
    });
    const beforeDelivery = await requestBilling(
      configuredShop,
      staged.id,
      "before_delivery",
    );
    assert.equal(beforeDelivery.amount, 6050);
    await db.billingRequest.update({
      where: { id: beforeDelivery.id },
      data: {
        status: "linked",
        invoiceState: "posted",
        paymentState: "not_paid",
        error: null,
      },
    });
    await assert.rejects(
      () => requestBilling(configuredShop, staged.id, "after_delivery"),
      /livraison a eu lieu/,
    );
    assert.equal(
      (
        await requestBilling(
          configuredShop,
          staged.id,
          "after_delivery",
          "test-user",
          true,
        )
      ).amount,
      2420,
    );
    const q = await make();
    const a = await requestBilling(configuredShop, q.id, "deposit");
    assert.equal(a.amount, 3630);
    assert.equal(
      (await requestBilling(configuredShop, q.id, "deposit")).id,
      a.id,
    );
    await assert.rejects(() => requestBilling("other-shop", q.id, "deposit"));
    await assert.rejects(() => requestBilling(configuredShop, q.id, "balance"));
    let writes = 0,
      invoiceUpdates = 0,
      remote: any = null,
      remoteLines: any[] = [],
      loseResponse = false,
      readFailure = false,
      credits = false,
      partnerExists = true,
      partnerCreates = 0;
    const rpc: any = async (
      model: string,
      method: string,
      args: any[],
      kwargs: any,
    ) => {
      if (model === "res.partner" && method === "search_read")
        return partnerExists
          ? [{ id: 10, vat: "BE0123456789", email: "test@example.com", name: "Client test" }]
          : [];
      if (model === "res.partner" && method === "create") {
        partnerCreates++;
        partnerExists = true;
        assert.equal(args[0].vat, "BE0123456789");
        assert.equal(args[0].is_company, true);
        return 10;
      }
      if (model === "res.partner" && method === "read")
        return [{ id: 10, vat: "BE0123456789", email: "test@example.com", name: "Client test" }];
      if (model === "res.country") return [{ id: 21, code: "BE" }];
      if (model === "res.company") return [{ currency_id: [1, "EUR"] }];
      if (model === "account.journal")
        return [{ type: "sale", code: "INV", company_id: [1, "Mikado"] }];
      if (model === "account.account")
        return [{ code: "700000" }];
      if (model === "account.tax")
        return [
          {
            amount: 21,
            amount_type: "percent",
            price_include: false,
            type_tax_use: "sale",
            company_id: [1, "Mikado"],
            active: true,
          },
        ];
      if (model === "account.move" && method === "create") {
        writes++;
        const vals = args[0];
        assert.equal(vals.state, undefined);
        assert.equal(vals.move_type, "out_invoice");
        assert.match(vals.payment_reference, /^Acompte devis MD-\d{4}-\d{4}$/);
        remoteLines = vals.invoice_line_ids.map((command: any, index: number) => ({
          id: 1000 + writes * 100 + index,
          name: command[2].name,
          tax_ids: [5],
          account_id: [438, "700000"],
          price_subtotal: command[2].price_unit,
          price_total: Number((command[2].price_unit * 1.21).toFixed(2)),
        }));
        remote = {
          id: 100 + writes,
          name: "/",
          state: "draft",
          payment_state: "not_paid",
          amount_total: 36.3,
          amount_untaxed: 30,
          amount_tax: 6.3,
          amount_residual: 36.3,
          currency_id: [1, "EUR"],
          company_id: [1, "Mikado"],
          partner_id: [10, "Test"],
          ref: vals.ref,
          payment_reference: vals.payment_reference,
          invoice_origin: vals.invoice_origin,
          invoice_date: vals.invoice_date,
          invoice_line_ids: remoteLines.map((line) => line.id),
          reversed_entry_id: false,
        };
        if (loseResponse) throw Error("Network");
        return remote.id;
      }
      if (model === "account.move" && method === "write") {
        assert.deepEqual(args[0], [remote.id]);
        assert.match(
          args[1].payment_reference,
          /^Acompte devis MD-\d{4}-\d{4}$/,
        );
        remote.payment_reference = args[1].payment_reference;
        invoiceUpdates++;
        return true;
      }
      if (model === "account.move" && method === "read") {
        if (readFailure) throw Error("Network");
        return [remote];
      }
      if (model === "account.move.line" && method === "read")
        return remoteLines;
      if (args[0][0][0] === "reversed_entry_id")
        return credits ? [{ id: 200 }] : [];
      if (
        args[0].some((x: any) => Array.isArray(x) && x[0] === "invoice_origin")
      )
        return [];
      return remote ? [remote] : [];
    };
    await Promise.all([processBilling(a.id, rpc), processBilling(a.id, rpc)]);
    assert.equal(writes, 1);
    let stored = await db.billingRequest.findUniqueOrThrow({
      where: { id: a.id },
    });
    assert.equal(stored.invoiceState, "draft");
    assert.equal(stored.residual, 3630);
    remote.payment_reference = false;
    await processBilling(a.id, rpc);
    assert.equal(invoiceUpdates, 1);
    assert.equal(remote.payment_reference, `Acompte devis ${q.number}`);
    remote.state = "posted";
    remote.payment_state = "partial";
    remote.amount_residual = 20;
    await processBilling(a.id, rpc);
    stored = await db.billingRequest.findUniqueOrThrow({ where: { id: a.id } });
    assert.equal(stored.paymentState, "partial");
    assert.equal(stored.residual, 2000);
    const balance = await requestBilling(configuredShop, q.id, "balance");
    assert.equal(balance.amount, 8470);
    assert.equal(
      (await requestBilling(configuredShop, q.id, "balance")).id,
      balance.id,
    );
    remote.amount_total = 40;
    await processBilling(a.id, rpc);
    assert.match(
      (await db.billingRequest.findUniqueOrThrow({ where: { id: a.id } }))
        .error!,
      /diffèrent/,
    );
    remote.amount_total = 36.3;
    credits = true;
    await processBilling(a.id, rpc);
    assert.match(
      (await db.billingRequest.findUniqueOrThrow({ where: { id: a.id } }))
        .error!,
      /avoir/,
    );
    credits = false;
    const q2 = await make(),
      a2 = await requestBilling(configuredShop, q2.id, "deposit");
    remote = null;
    loseResponse = true;
    await processBilling(a2.id, rpc);
    assert.equal(
      (await db.billingRequest.findUniqueOrThrow({ where: { id: a2.id } }))
        .status,
      "uncertain",
    );
    await assert.rejects(() => retryBilling(configuredShop, q2.id, a2.id));
    loseResponse = false;
    const before = writes;
    await processBilling(a2.id, rpc);
    assert.equal(writes, before);
    assert.equal(
      (await db.billingRequest.findUniqueOrThrow({ where: { id: a2.id } }))
        .status,
      "linked",
    );
    // A lost read must preserve the last known figures, never turn them into zero.
    const offline: any = async () => {
      throw Error("offline");
    };
    await processBilling(a2.id, offline);
    assert.equal(
      (await db.billingRequest.findUniqueOrThrow({ where: { id: a2.id } }))
        .residual,
      3630,
    );
    await assert.rejects(() => simulateBilling(configuredShop, q2.id, "paid"));
    await assert.rejects(() => acceptOrder(configuredShop, q2.id, 1, null));

    const q3 = await make(),
      a3 = await requestBilling(configuredShop, q3.id, "deposit");
    partnerExists = false;
    remote = null;
    remoteLines = [];
    const writesBeforeAutomaticPartner = writes;
    await processBilling(a3.id, rpc);
    assert.equal(partnerCreates, 1);
    assert.equal(writes, writesBeforeAutomaticPartner + 1);
    assert.equal(
      (await db.billingRequest.findUniqueOrThrow({ where: { id: a3.id } }))
        .status,
      "linked",
    );
    await processBilling(a3.id, rpc);
    assert.equal(partnerCreates, 1);
  } finally {
    await db.billingRequest.deleteMany({
      where: { quote: { shop: configuredShop } },
    });
    await db.quote.deleteMany({ where: { shop: configuredShop } });
    for (const [k, v] of Object.entries(previous))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  }
});

test("commande définitive : attente de paiement et récupération après coupure", async () => {
  const { acceptOrder, orderOperations } =
    await import("../../app/services/order.server");
  const tenant = `order-${Date.now()}.local`;
  const values = {
    ODOO_AUTOMATION_ENABLED: "true",
    ODOO_LEGACY_GUARD_CONFIRMED: "true",
    ODOO_SHOP: tenant,
    ODOO_URL: "https://odoo.example",
    ODOO_DB: "test",
    ODOO_LOGIN: "test",
    ODOO_API_KEY: "test",
    ODOO_COMPANY_ID: "1",
    ODOO_JOURNAL_ID: "8",
    ODOO_ACCOUNT_ID: "438",
    ODOO_TAX_ID: "5",
  };
  const previous = Object.fromEntries(
    Object.keys(values).map((k) => [k, process.env[k]]),
  );
  Object.assign(process.env, values);
  const source = mock();
  const q = await createQuote(tenant, state());
  await publishQuote(tenant, q.id, 1, source.admin);
  await convertQuote(tenant, q.id, 1, source.admin);
  let external: any = null,
    writes = 0;
  const admin: Admin = {
    graphql: async (query, options) => {
      if (query === orderOperations.lookup)
        return Response.json({
          data: {
            draftOrder: { id: "gid://shopify/DraftOrder/123", order: external },
          },
        });
      if (query === orderOperations.inspect)
        return Response.json({ data: { order: external } });
      if (query === orderOperations.complete) {
        assert.match(query, /paymentPending:true/);
        writes++;
        external = {
          id: "gid://shopify/Order/555",
          name: "#555",
          displayFinancialStatus: "PENDING",
          cancelledAt: null,
          totalPriceSet: {
            presentmentMoney: { amount: "121.00", currencyCode: "EUR" },
          },
        };
        throw Error("Réponse perdue après création Shopify");
      }
      return source.admin.graphql(query, options);
    },
  };
  try {
    await assert.rejects(() => acceptOrder(tenant, q.id, 1, admin));
    assert.equal(
      (await getQuote(tenant, q.id)).conversion?.orderStatus,
      "uncertain",
    );
    await acceptOrder(tenant, q.id, 1, admin);
    const accepted = await getQuote(tenant, q.id);
    assert.equal(accepted.conversion?.orderId, external.id);
    assert.equal(accepted.conversion?.orderStatus, "complete");
    assert.equal(writes, 1);
    await acceptOrder(tenant, q.id, 1, admin);
    assert.equal(writes, 1);
  } finally {
    await db.quote.deleteMany({ where: { shop: tenant } });
    for (const [k, v] of Object.entries(previous))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  }
});

test("statuts commerciaux, corbeille et restauration conservent les versions", async () => {
  const { trashQuote, restoreTrashedQuote } =
    await import("../../app/services/quotes.server");
  const { commercialStatus } = await import("../../app/domain/quote");
  const tenant = `${shop}-lifecycle`;
  try {
    const q = await createQuote(tenant, state());
    assert.equal(commercialStatus(await getQuote(tenant, q.id)), "Brouillon");
    await assert.rejects(() => markSent(tenant, q.id, 1));
    await db.revision.update({
      where: { quoteId_version: { quoteId: q.id, version: 1 } },
      data: {
        publishedNumber: 1,
        pdfGeneratedAt: new Date(),
        pdf: Buffer.from("pdf"),
      },
    });
    assert.equal(
      commercialStatus(await getQuote(tenant, q.id)),
      "Prêt à envoyer · R1",
    );
    await markSent(tenant, q.id, 1);
    assert.equal(commercialStatus(await getQuote(tenant, q.id)), "Envoyé · R1");
    await assert.rejects(() => trashQuote("other-shop", q.id, 1));
    await trashQuote(tenant, q.id, 1);
    assert.equal((await listQuotes(tenant)).total, 0);
    assert.equal((await listQuotes(tenant, "", "deleted")).total, 1);
    await assert.rejects(() => saveQuote(tenant, q.id, 1, state()));
    await assert.rejects(() => markSent(tenant, q.id, 1));
    await assert.rejects(() => archiveQuote(tenant, q.id, 1));
    await restoreTrashedQuote(tenant, q.id, 1);
    assert.equal(commercialStatus(await getQuote(tenant, q.id)), "Envoyé · R1");
    const changed = state();
    changed.project = "Nouvelle proposition";
    await saveQuote(tenant, q.id, 1, changed);
    assert.equal(
      commercialStatus(await getQuote(tenant, q.id)),
      "Modifications en cours",
    );
    assert.equal((await listQuotes(tenant, "", "sent")).total, 0);
    assert.equal((await listQuotes(tenant, "", "draft")).total, 1);
    await archiveQuote(tenant, q.id, 2);
    assert.equal(commercialStatus(await getQuote(tenant, q.id)), "Archivé");
  } finally {
    await db.quote.deleteMany({ where: { shop: tenant } });
  }
});

test("nouveau PDF : révision forcée sans modifier les données ni l'ancien PDF", async () => {
  const tenant = `${shop}-refresh-document`;
  try {
    const s = state();
    const q = await createQuote(tenant, s);
    await db.revision.update({
      where: { quoteId_version: { quoteId: q.id, version: 1 } },
      data: {
        pdf: Buffer.from("original"),
        pdfGeneratedAt: new Date(),
        publishedNumber: 1,
        sentAt: new Date(),
      },
    });
    assert.equal(await saveQuote(tenant, q.id, 1, s), 1);
    assert.equal(await saveQuote(tenant, q.id, 1, s, true), 2);
    const old = await db.revision.findUniqueOrThrow({
      where: { quoteId_version: { quoteId: q.id, version: 1 } },
    });
    assert.equal(Buffer.from(old.pdf!).toString(), "original");
    assert.ok(old.sentAt);
    const current = await db.revision.findUniqueOrThrow({
      where: { quoteId_version: { quoteId: q.id, version: 2 } },
    });
    assert.equal(current.state, old.state);
    assert.equal(current.pdf, null);
    assert.equal(current.sentAt, null);
    await assert.rejects(() => saveQuote(tenant, q.id, 1, s, true));
  } finally {
    await db.quote.deleteMany({ where: { shop: tenant } });
  }
});

test("devis sans livraison : publication possible, commande toujours protégée", async () => {
  const tenant = `${shop}-no-delivery`;
  try {
    const s = state();
    s.taxPolicy = "BE21";
    s.shipping = { ...s.shipping, address1: "", city: "", zip: "" };
    const q = await createQuote(tenant, s);
    const admin = {
      graphql: async () => {
        throw Error("Aucun calcul Shopify attendu sans adresse");
      },
    };
    await publishSnapshot(tenant, q.id, 1, admin);
    const r = await db.revision.findUniqueOrThrow({
      where: { quoteId_version: { quoteId: q.id, version: 1 } },
    });
    assert.equal(r.publishedNumber, 1);
    assert.equal(r.calculation, null);
    assert.equal(JSON.parse(r.state).shipping.address1, "");
    await assert.rejects(
      () =>
        previewConversion(tenant, q.id, 1, {
          graphql: async () =>
            Response.json({
              data: {
                shop: {
                  name: "Test",
                  currencyCode: "EUR",
                  taxesIncluded: false,
                },
              },
            }),
        }),
      /adresse de livraison/,
    );
    await assert.rejects(() => convertQuote(tenant, q.id, 1, admin));
  } finally {
    await db.quote.deleteMany({ where: { shop: tenant } });
  }
});
