import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyQuote,
  setDeliveryFee,
  clientNames,
  withClientNames,
  clientView,
  newQuote,
  costBreakdown,
  paymentSchedule,
  quoteSchema,
  totals,
  lineTotal,
  lineTax,
  cents,
  fiscalTotals,
  fromGross,
  setQuantity,
  removeLine,
  upgradeQuote,
  repriceExtras,
  applyMikadoPolicy,
  quoteSections,
} from "../app/domain/quote";
import {
  customerSearch,
  demoLines,
  draftInput,
  calculate,
  prepareCalculation,
  products,
  verifyCreatedDraft,
} from "../app/services/shopify-api.server";
import { conversionTag } from "../app/services/conversion.server";
import {
  billingInvoiceLines,
  billingMilestones,
} from "../app/domain/billing";
export function fixture() {
  const s = emptyQuote();
  s.taxPolicy = "historical";
  s.shipping = {
    ...s.shipping,
    address1: "Rue du Test 1",
    city: "Bruxelles",
    zip: "1000",
  };
  s.groups = [
    {
      id: "chairs",
      syncQty: true,
      sectionId: "test-section",
      section: "Salle",
      selected: "alba",
      items: [
        { ...demoLines[0], id: "noma", qty: 40 },
        { ...demoLines[1], id: "alba", qty: 40 },
      ],
    },
  ];
  s.extras = [
    {
      ...demoLines[0],
      id: "install",
      name: "Installation",
      qty: 1,
      price: 35000,
      selected: true,
    },
  ];
  return s;
}
test("recherche client : l’e-mail utilise le filtre Shopify dédié", () => {
  assert.equal(customerSearch("marie@example.com"), "email:marie@example.com*");
  assert.equal(customerSearch("Maison Auguste"), "Maison* Auguste*");
});
test("le marqueur de conversion Shopify reste sous la limite de 40 caractères", () => {
  const id = "cmuwkdrv90001v7si7f8tjzo5";
  const tag = conversionTag(id);
  assert.equal(tag, `mikado-${id}`);
  assert.ok(tag.length <= 40);
});
test("une alternative remplace la base et seules les options retenues comptent", () => {
  const s = fixture();
  assert.deepEqual(totals(s), {
    base: 400000,
    delta: 80000,
    extras: 35000,
    total: 515000,
  });
  s.extras[0].selected = false;
  assert.equal(totals(s).total, 480000);
});
test("arrondi en centimes avec quantité et remise", () =>
  assert.equal(
    lineTotal({ ...demoLines[0], price: 1999, qty: 3, discount: 15 }),
    5097,
  ));
test("la TVA est arrondie sur le total de la ligne", () => {
  const line = {
    ...demoLines[0],
    price: 16446,
    qty: 3,
    discount: 0,
    vatRate: 21,
    taxable: true,
  };
  assert.equal(lineTax(line), 10361);
});
test("les écarts fiscaux Shopify limités aux arrondis unitaires restent compatibles", async () => {
  const s = fixture();
  const item = {
    ...s.groups[0].items[1],
    price: 37107,
    qty: 8,
    discount: 15,
    vatRate: 21,
    taxable: true,
  };
  s.groups = [{ ...s.groups[0], items: [item], selected: item.id }];
  s.extras = [];
  const input = draftInput(s, "TEST", "mikado-test", true);
  const admin = {
    graphql: async () =>
      Response.json({
        data: {
          draftOrderCalculate: {
            calculatedDraftOrder: {
              totalPriceSet: {
                presentmentMoney: { amount: "3053.14", currencyCode: "EUR" },
              },
              totalTaxSet: {
                presentmentMoney: { amount: "529.88", currencyCode: "EUR" },
              },
              subtotalPriceSet: {
                presentmentMoney: { amount: "2523.26", currencyCode: "EUR" },
              },
              taxesIncluded: true,
              taxLines: [
                {
                  rate: 0.21,
                  priceSet: {
                    presentmentMoney: {
                      amount: "529.88",
                      currencyCode: "EUR",
                    },
                  },
                },
              ],
              lineItems: [
                {
                  uuid: item.id,
                  quantity: 8,
                  discountedTotalSet: {
                    presentmentMoney: {
                      amount: "3053.14",
                      currencyCode: "EUR",
                    },
                  },
                },
              ],
            },
            userErrors: [],
          },
        },
      }),
  };
  const result = await calculate(admin, s, input);
  assert.equal(result.matches, true);
  assert.equal(result.difference, -2);
});
test("la préparation Shopify absorbe un écart d’arrondi dans la livraison", async () => {
  const s = fixture();
  s.extras[0].deliveryFee = true;
  const fiscal = fiscalTotals(s);
  const bag = (value: number) => ({
    presentmentMoney: { amount: (value / 100).toFixed(2), currencyCode: "EUR" },
  });
  const admin = {
    graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
      if (query.includes("shop {"))
        return Response.json({
          data: {
            shop: { name: "Test", currencyCode: "EUR", taxesIncluded: true },
          },
        });
      const input = options?.variables?.input as ReturnType<typeof draftInput>;
      const delivery = input.lineItems.find((line) => line.uuid === "install")!;
      const deliveryPrice = Math.round(
        Number(
          "priceOverride" in delivery
            ? delivery.priceOverride.amount
            : delivery.originalUnitPriceWithCurrency.amount,
        ) * 100,
      );
      const adjusted = deliveryPrice === 42345;
      const total = fiscal.gross + (adjusted ? 0 : 5);
      const tax = fiscal.tax + (adjusted ? 0 : 1);
      return Response.json({
        data: {
          draftOrderCalculate: {
            calculatedDraftOrder: {
              totalPriceSet: bag(total),
              totalTaxSet: bag(tax),
              subtotalPriceSet: bag(total - tax),
              taxesIncluded: true,
              taxLines: [{ rate: 0.21, priceSet: bag(tax) }],
              lineItems: input.lineItems.map((line) => {
                const price = Math.round(
                  Number(
                    "priceOverride" in line
                      ? line.priceOverride.amount
                      : line.originalUnitPriceWithCurrency.amount,
                  ) * 100,
                );
                return {
                  uuid: line.uuid,
                  quantity: line.quantity,
                  discountedTotalSet: bag(
                    Math.round(
                      (price *
                        line.quantity *
                        (100 - (line.appliedDiscount?.value || 0))) /
                        100,
                    ),
                  ),
                };
              }),
            },
            userErrors: [],
          },
        },
      });
    },
  };
  const prepared = await prepareCalculation(
    admin,
    s,
    "DEV-TEST",
    "mikado-test",
  );
  assert.equal(prepared.calculation.roundingAdjustment, -5);
  assert.equal(prepared.calculation.total, fiscal.gross);
  assert.equal(prepared.calculation.tax, fiscal.tax);
  assert.equal(prepared.calculation.matches, true);
  const delivery = prepared.input.lineItems.find(
    (line) => line.uuid === "install",
  )!;
  assert.equal(
    "priceOverride" in delivery
      ? delivery.priceOverride.amount
      : delivery.originalUnitPriceWithCurrency.amount,
    "423.45",
  );
});
test("la vérification accepte l’arrondi Shopify d’un centime sur une ligne", async () => {
  const s = fixture();
  s.groups[0].items = [{ ...s.groups[0].items[1], id: "rounded", qty: 2 }];
  s.groups[0].selected = "rounded";
  s.extras = [];
  const expected = draftInput(s, "Vérification", "verification", true)
    .lineItems[0];
  const price = Math.round(
    Number(
      "priceOverride" in expected
        ? expected.priceOverride.amount
        : expected.originalUnitPriceWithCurrency.amount,
    ) * 100,
  );
  const expectedTotal = Math.round(
    (price * expected.quantity * (100 - (expected.appliedDiscount?.value || 0))) /
      100,
  );
  const admin = {
    graphql: async () =>
      Response.json({
        data: {
          draftOrder: {
            id: "gid://shopify/DraftOrder/1",
            name: "#D1",
            totalPriceSet: {
              presentmentMoney: { amount: "290.40", currencyCode: "EUR" },
            },
            totalTaxSet: {
              presentmentMoney: { amount: "50.40", currencyCode: "EUR" },
            },
            lineItems: {
              nodes: [
                {
                  uuid: "rounded",
                  quantity: 2,
                  variant: null,
                  discountedTotalSet: {
                    presentmentMoney: {
                      amount: ((expectedTotal + 1) / 100).toFixed(2),
                      currencyCode: "EUR",
                    },
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      }),
  };
  const result = await verifyCreatedDraft(
    admin,
    "gid://shopify/DraftOrder/1",
    s,
    {
      total: 29040,
      tax: 5040,
      subtotal: 24000,
      taxesIncluded: true,
      currency: "EUR",
      localTotal: 24000,
      demo: false,
      taxLines: [{ rate: 21, amount: 5040 }],
      difference: 0,
      matches: true,
    },
  );
  assert.equal(result.name, "#D1");
});
test("sélections absentes et identifiants dupliqués rejetés", () => {
  const s = fixture();
  s.groups[0].selected = "absent";
  assert.equal(quoteSchema.safeParse(s).success, false);
  s.groups[0].selected = "alba";
  s.extras[0].id = "alba";
  assert.equal(quoteSchema.safeParse(s).success, false);
});
test("prix convenu et variante conservés dans la commande", () => {
  const s = fixture();
  s.groups[0].items[1].variantId = "gid://shopify/ProductVariant/123";
  const input = draftInput(s, "DEV-TEST", "test");
  assert.equal(input.lineItems.length, 2);
  assert.ok("priceOverride" in input.lineItems[0]);
  assert.deepEqual(input.lineItems[0].priceOverride, {
    amount: "120.00",
    currencyCode: "EUR",
  });
  assert.equal(
    input.lineItems[0].variantId,
    "gid://shopify/ProductVariant/123",
  );
});
test("conversion monétaire sans perte de centimes", () => {
  assert.equal(cents("12.34"), 1234);
  assert.equal(cents("12.3"), 1230);
  assert.throws(() => cents("12,30"));
});

test("HTVA, TVA, TVAC et acompte : scénario contract", () => {
  const s = fixture();
  s.depositPercent = 30;
  const f = fiscalTotals(s);
  assert.equal(f.complete, true);
  assert.equal(f.net, 515000);
  assert.equal(f.tax, 108150);
  assert.equal(f.gross, 623150);
  assert.equal(f.deposit, 186945);
  assert.equal(f.balance, 436205);
});
test("taux différents et option exclue", () => {
  const s = fixture();
  s.groups[0].items[1].vatRate = 6;
  s.extras[0].vatRate = 21;
  assert.equal(fiscalTotals(s).tax, 36150);
  s.extras[0].selected = false;
  assert.equal(fiscalTotals(s).tax, 28800);
  s.groups[0].items[1].vatRate = null;
  assert.equal(fiscalTotals(s).complete, false);
});
test("TVAC source : conversion explicite, jamais simple changement de libellé", () => {
  const l = {
    ...demoLines[0],
    sourcePrice: 12100,
    sourceIncludesTax: true,
    price: 0,
    priceConfirmed: false,
  };
  const net = fromGross(l, 21);
  assert.equal(net.price, 10000);
  assert.equal(net.sourcePrice, 12100);
  assert.equal(net.sourceVatRate, 21);
  assert.equal(net.priceConfirmed, true);
  const s = fixture();
  s.groups[0].items[1].priceConfirmed = false;
  assert.equal(fiscalTotals(s).complete, false);
});
test("quantités liées et désynchronisation explicite", () => {
  let s = fixture();
  s = setQuantity(s, "noma", 44);
  assert.equal(s.groups[0].items[1].qty, 44);
  s.groups[0].syncQty = false;
  s = setQuantity(s, "noma", 48);
  assert.equal(s.groups[0].items[1].qty, 44);
});
test("ancien devis TVAC conservé, copie B2B à vérifier", () => {
  const old = fixture();
  old.schemaVersion = 1;
  old.taxesIncluded = true;
  const copy = upgradeQuote(old);
  assert.equal(old.groups[0].items[0].price, 10000);
  assert.equal(copy.groups[0].items[0].price, 0);
  assert.equal(copy.groups[0].items[0].sourcePrice, 10000);
  assert.equal(copy.groups[0].items[0].priceConfirmed, false);
});
test("conversion dans un catalogue taxes incluses conserve le HTVA convenu", () => {
  const s = fixture();
  const input = draftInput(s, "REF", "TAG", true);
  const line = input.lineItems[0];
  assert.ok("originalUnitPriceWithCurrency" in line);
  assert.equal(line.originalUnitPriceWithCurrency.amount, "145.20");
  assert.ok(input.note.includes("Paiement :"));
  assert.ok(input.note.includes("Livraison :"));
});

test("frais proportionnels : produits retenus après remise, sans cumul des options", () => {
  let s = fixture();
  s.extras[0].chargePercent = 3;
  s = repriceExtras(s);
  assert.equal(s.extras[0].price, 14400);
  s.groups[0].selected = "noma";
  s = repriceExtras(s);
  assert.equal(s.extras[0].price, 12000);
  s.groups[0].items[0].discount = 10;
  s = repriceExtras(s);
  assert.equal(s.extras[0].price, 10800);
  assert.equal(fiscalTotals(s).net, 370800);
});
test("un prix de frais transmis par le navigateur est recalculé côté serveur", () => {
  const s = fixture();
  s.extras[0].chargePercent = 3;
  s.extras[0].price = 1;
  assert.equal(quoteSchema.parse(s).extras[0].price, 14400);
});

test("catalogue : description exacte, aucune invention et conversion TVAC à 21 %", async () => {
  for (const description of ["", "Description exacte du catalogue."]) {
    const admin = {
      graphql: async (query: string) =>
        Response.json({
          data: query.includes("productVariants")
            ? {
                productVariants: {
                  nodes: [
                    {
                      id: "gid://shopify/ProductVariant/100",
                      displayName: "Article",
                      sku: "A",
                      taxable: true,
                      price: "121.00",
                      product: {
                        description,
                        featuredMedia: {
                          preview: {
                            image: {
                              url: "https://cdn.shopify.com/product.jpg",
                            },
                          },
                        },
                      },
                      image: null,
                    },
                  ],
                  pageInfo: { hasNextPage: false, endCursor: "" },
                },
              }
            : {
                shop: {
                  name: "Test",
                  currencyCode: "EUR",
                  taxesIncluded: true,
                },
              },
        }),
    };
    const { items } = await products(admin, "");
    assert.equal(items[0].detail, description);
    assert.equal(items[0].image, "https://cdn.shopify.com/product.jpg");
    assert.equal(items[0].price, 10000);
    assert.equal(items[0].vatRate, 21);
    assert.equal(items[0].priceConfirmed, true);
  }
});

test("politique 21 % refuse les taux cachés et migration explicite préserve la source", () => {
  const s = fixture();
  s.groups[0].items[0].vatRate = 6;
  const old = JSON.stringify(s);
  assert.throws(() => quoteSchema.parse({ ...s, taxPolicy: "BE21" }));
  const upgraded = applyMikadoPolicy(s);
  assert.equal(upgraded.groups[0].items[0].vatRate, 21);
  assert.equal(JSON.stringify(s), old);
});
test("modalités structurées : texte et acompte restent cohérents", () => {
  const s = fixture();
  const result = quoteSchema.parse({
    ...s,
    payment: "deposit",
    depositPercent: 45,
    terms: "Acompte 30 %",
  });
  assert.match(result.terms, /45 %/);
  assert.match(result.terms, /55 %/);
  const full = quoteSchema.parse({ ...s, payment: "full", depositPercent: 20 });
  assert.equal(full.depositPercent, 100);
  assert.equal(full.terms, "Paiement intégral à la commande");
});
test("échéancier 30/50/20 : texte, montants et arrondi restent cohérents", () => {
  const s = quoteSchema.parse({
    ...fixture(),
    payment: "installments",
    depositPercent: null,
  });
  assert.equal(s.depositPercent, 30);
  assert.equal(
    s.terms,
    "30 % d’acompte à la commande, 50 % avant livraison et 20 % après livraison",
  );
  const schedule = paymentSchedule(s, 10001);
  assert.deepEqual(
    schedule.map((stage) => stage.amount),
    [3000, 5001, 2000],
  );
  assert.equal(
    schedule.reduce((sum, stage) => sum + stage.amount, 0),
    10001,
  );
});
test("facturation 30/50/20 : chaque jalon retombe exactement sur HTVA, TVA et TVAC", () => {
  const s = quoteSchema.parse({
    ...applyMikadoPolicy(fixture()),
    payment: "installments",
    depositPercent: null,
  });
  const totals = fiscalTotals(s),
    milestones = billingMilestones(s),
    lines = milestones.map((milestone) =>
      billingInvoiceLines(s, milestone),
    );
  assert.equal(
    milestones.reduce((sum, milestone) => sum + milestone.net, 0),
    totals.net,
  );
  assert.equal(
    milestones.reduce((sum, milestone) => sum + milestone.tax, 0),
    totals.tax,
  );
  assert.equal(
    milestones.reduce((sum, milestone) => sum + milestone.amount, 0),
    totals.gross,
  );
  for (const [index, milestoneLines] of lines.entries()) {
    assert.equal(
      milestoneLines.reduce((sum, line) => sum + line.net, 0),
      milestones[index].net,
    );
    assert.equal(
      milestoneLines.reduce((sum, line) => sum + line.tax, 0),
      milestones[index].tax,
    );
    assert.ok(milestoneLines.every((line) => !/arrondi/i.test(line.name)));
  }
});
test("lots homonymes restent distincts grâce aux identifiants", () => {
  const s = fixture();
  s.groups.push({
    ...s.groups[0],
    id: "other",
    sectionId: "other-section",
    selected: "x",
    items: [{ ...s.groups[0].items[0], id: "x" }],
  });
  assert.equal(quoteSections(s).length, 2);
});

test("même variante répétée : lignes indépendantes dans un lot et entre lots", () => {
  const s = fixture();
  const base = {
    ...s.groups[0].items[0],
    variantId: "gid://shopify/ProductVariant/123",
    price: 10000,
    qty: 1,
    discount: 0,
    vatRate: 21,
    taxable: true,
  };
  s.groups = [
    {
      id: "g1",
      sectionId: "lot1",
      section: "Salon",
      syncQty: true,
      selected: "a",
      items: [{ ...base, id: "a", qty: 2 }],
    },
    {
      id: "g2",
      sectionId: "lot1",
      section: "Salon",
      syncQty: true,
      selected: "b",
      items: [{ ...base, id: "b", discount: 10 }],
    },
    {
      id: "g3",
      sectionId: "lot2",
      section: "Chambre",
      syncQty: true,
      selected: "c",
      items: [
        { ...base, id: "c", qty: 3, discount: 20 },
        { ...base, id: "alternative", qty: 3, discount: 30 },
      ],
    },
  ];
  s.extras = [];
  quoteSchema.parse(s);
  assert.equal(totals(s).total, 53000);
  const input = draftInput(s, "test", "test");
  assert.equal(input.lineItems.length, 3);
  assert.deepEqual(
    input.lineItems.map((l) => l.uuid),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    input.lineItems.map((l) => l.quantity),
    [2, 1, 3],
  );
  assert.equal(
    new Set(input.lineItems.map((l) => "variantId" in l && l.variantId)).size,
    1,
  );
  s.groups = setQuantity(s, "a", 4).groups;
  assert.equal(s.groups[1].items[0].qty, 1);
  assert.equal(s.groups[2].items[0].qty, 3);
  s.groups[2].selected = "alternative";
  assert.equal(totals(s).total, 70000);
  s.groups = s.groups.filter((g) => g.id !== "g2");
  assert.equal(totals(s).total, 61000);
  assert.deepEqual(
    draftInput(s, "test", "test").lineItems.map((l) => l.uuid),
    ["a", "alternative"],
  );
});

test("supprimer le premier article conserve les autres articles du lot", () => {
  const s = fixture();
  const firstGroup = s.groups[0];
  s.groups = [
    {
      ...firstGroup,
      id: "relax-sofa",
      sectionId: "relax",
      section: "Coin Relax",
      selected: "sofa",
      items: [{ ...firstGroup.items[0], id: "sofa", name: "Canapé" }],
    },
    {
      ...firstGroup,
      id: "meeting-table",
      sectionId: "meeting-room-1",
      section: "Salle de réunion 1",
      selected: "table",
      items: [{ ...firstGroup.items[0], id: "table", name: "Table" }],
    },
    {
      ...firstGroup,
      id: "ceo-chair",
      sectionId: "ceo-office",
      section: "Bureau CEO",
      selected: "ceo",
      items: [{ ...firstGroup.items[0], id: "ceo", name: "Fauteuil" }],
    },
    {
      ...firstGroup,
      id: "meeting-chairs",
      sectionId: "meeting-room-1",
      section: "Salle de réunion 1",
      selected: "chairs",
      items: [{ ...firstGroup.items[1], id: "chairs", name: "Chaises" }],
    },
  ];

  const updated = removeLine(s, "table");
  const sections = quoteSections(updated);

  assert.equal(updated.groups.length, 3);
  assert.deepEqual(
    sections.map((section) => section.title),
    ["Coin Relax", "Salle de réunion 1", "Bureau CEO"],
  );
  assert.equal(sections[1].groups[0].items[0].name, "Chaises");
});

test("supprimer la base d'un choix conserve l'alternative et la sélection", () => {
  const s = fixture();
  const updated = removeLine(s, "noma");

  assert.equal(updated.groups.length, 1);
  assert.deepEqual(
    updated.groups[0].items.map((item) => item.id),
    ["alba"],
  );
  assert.equal(updated.groups[0].selected, "alba");
});

test("livraison à 3 % : remise, recalcul, TVA, activation unique et retrait", () => {
  let s = applyMikadoPolicy(fixture());
  s.groups[0].syncQty = false;
  s.groups[0].items[1].price = 10000;
  s.groups[0].items[1].qty = 2;
  s.groups[0].items[1].discount = 15;
  const before = totals(s).total;
  s = setDeliveryFee(s, true, "delivery", 3);
  assert.equal(
    s.extras.find((e) => e.deliveryFee)?.name,
    "Livraison + montage",
  );
  assert.equal(s.extras.find((e) => e.deliveryFee)?.price, 510);
  assert.equal(totals(s).total, before + 510);
  assert.deepEqual(costBreakdown(s), {
    products: 17000,
    options: 35000,
    delivery: 510,
    total: 52510,
  });
  assert.equal(quoteSchema.safeParse(s).success, true);
  const withTax = fiscalTotals(s);
  assert.equal(withTax.complete, true);
  assert.equal(
    withTax.gross - fiscalTotals(setDeliveryFee(s, false, "unused")).gross,
    617,
  );
  const delivery = draftInput(s, "TEST", "test").lineItems.find(
    (l) => l.uuid === "delivery",
  );
  assert.ok(delivery && "originalUnitPriceWithCurrency" in delivery);
  s = setDeliveryFee(s, true, "another-id");
  assert.equal(s.extras.filter((e) => e.deliveryFee).length, 1);
  s.groups[0].items[1].qty = 4;
  s = repriceExtras(s);
  assert.equal(s.extras.find((e) => e.deliveryFee)?.price, 1020);
  s = setDeliveryFee(s, false, "unused");
  assert.equal(
    s.extras.some((e) => e.deliveryFee),
    false,
  );
  assert.equal(s.extras.length, 1);
});

test("livraison + montage : 4 % par défaut sur un nouveau devis, taux modifiable", () => {
  let s = newQuote();
  const fee = () => s.extras.find((e) => e.deliveryFee);
  assert.equal(fee()?.chargePercent, 4);
  assert.equal(fee()?.price, 0);
  s.groups = fixture().groups;
  s.groups[0].syncQty = false;
  s = repriceExtras(s);
  const base = costBreakdown(s).products;
  assert.equal(fee()?.price, Math.round(base * 0.04));
  s = setDeliveryFee(s, true, fee()!.id, 5);
  assert.equal(fee()?.price, Math.round(base * 0.05));
  assert.equal(s.extras.filter((e) => e.deliveryFee).length, 1);
  s = setDeliveryFee(s, false, "x");
  assert.equal(fee(), undefined);
});

test("fiche client : prénom, nom, société facultative", () => {
  const s = emptyQuote();
  const named = withClientNames({ ...s, firstName: " Anne ", lastName: "Dupont", company: "" });
  assert.equal(named.client, "Anne Dupont");
  assert.equal(named.contact, "Anne Dupont");
  assert.equal(named.shipping.lastName, "Dupont");
  const firm = withClientNames({ ...s, firstName: "Anne", lastName: "Dupont", company: "Studio A" });
  assert.equal(firm.client, "Studio A");
  assert.equal(firm.billing.company, "Studio A");
  // Devis plus ancien : noms retrouvés depuis client et contact.
  assert.deepEqual(clientNames({ ...s, client: "Studio A", contact: "Anne Dupont" }), {
    firstName: "Anne",
    lastName: "Dupont",
    company: "Studio A",
  });
});

test("version client : sans les remises de l'architecte, au choix", () => {
  let s = repriceExtras({ ...newQuote(), groups: fixture().groups });
  s.groups[0].items = s.groups[0].items.map((i) => ({ ...i, discount: 20 }));
  s = repriceExtras(s);
  assert.equal(clientView(s), s);
  const shown = clientView({ ...s, hideDiscounts: true });
  assert.ok(shown.groups.every((g) => g.items.every((i) => i.discount === 0)));
  assert.ok(costBreakdown(shown).products > costBreakdown(s).products);
  const fee = (x: typeof s) => x.extras.find((e) => e.deliveryFee)!.price;
  assert.equal(fee(shown), Math.round(costBreakdown(shown).products * 0.04));
  // Le devis lui-même garde les remises.
  assert.equal(s.groups[0].items[0].discount, 20);
});
