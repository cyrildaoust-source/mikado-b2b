import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyQuote,
  fiscalTotals,
  lineSchema,
  lineTotal,
  withExactGross,
  type QuoteState,
} from "../app/domain/quote";
import { proBilling, publicMerchandise } from "../app/domain/pro";

/** Ligne du catalogue Shopify (prix TVAC) telle que l'outil la crée. */
const shopLine = (id: string, gross: number, qty = 1, discount = 0, exactGross = true) =>
  lineSchema.parse({
    id, name: id, qty, discount, vatRate: 21,
    price: Math.round(gross / 1.21),
    sourcePrice: gross, sourceIncludesTax: true, sourceVatRate: 21,
    variantId: `gid://shopify/ProductVariant/${id.length}`,
    exactGross,
  });

function quote(...items: QuoteState["groups"][number]["items"]) {
  const s = emptyQuote();
  s.schemaVersion = 2;
  s.groups = items.map((l, i) => ({
    id: `g${i}`, section: "Salon", sectionId: "s", selected: l.id, syncQty: true, items: [l],
  }));
  return s;
}

test("TVAC exact : deux chaises à 50 € font 100,00 €, pas 99,99 €", () => {
  assert.equal(fiscalTotals(quote(shopLine("a", 5000, 2))).gross, 10000);
  assert.equal(fiscalTotals(quote(shopLine("a", 5500))).gross, 5500);
  // Tous les prix ronds de 1 à 5 000 €, quantités 1 à 4.
  for (let p = 100; p <= 500000; p += 100)
    for (const q of [1, 2, 3, 4])
      assert.equal(fiscalTotals(quote(shopLine("a", p, q))).gross, p * q, `${p / 100} € × ${q}`);
});

test("TVAC exact : même total et même TVA que le calcul Shopify du 27/11/2026", () => {
  // draftOrderCalculate sur la boutique : total 2 538,14 €, TVA 440,51 €.
  const f = fiscalTotals(
    quote(shopLine("a", 5000, 3), shopLine("bb", 5500), shopLine("ccc", 1000), shopLine("dddd", 124900, 2, 7)),
  );
  assert.equal(f.gross, 253814);
  assert.equal(f.tax, 44051);
  assert.equal(f.net, 253814 - 44051);
});

test("TVAC exact : révisions anciennes et prix modifiés gardent l'ancien calcul", () => {
  // Sans la marque, une révision figée avant le changement ne bouge pas.
  assert.equal(fiscalTotals(quote(shopLine("a", 5000, 2, 0, false))).gross, 9999);
  // Prix HTVA changé à la main : on ne repart plus du prix de la boutique.
  const changed = { ...shopLine("a", 5000), price: 4000 };
  assert.equal(lineTotal(changed), 4000);
  // Enregistrer un brouillon marque ses lignes du catalogue.
  const s = withExactGross(quote(shopLine("a", 5000, 2, 0, false)));
  assert.equal(fiscalTotals(s).gross, 10000);
});

test("facture architecte : les lignes saisies à la main n'y entrent pas", () => {
  const custom = lineSchema.parse({ id: "x", name: "Meuble sur mesure", qty: 1, price: 500000, discount: 0, vatRate: 21 });
  const s = quote(shopLine("a", 121000), custom);
  assert.equal(publicMerchandise(s), 100000);
  const b = proBilling(s, 10);
  assert.equal(b.merchandisePublic, 100000);
  assert.equal(b.merchandisePro, 90000);
});
