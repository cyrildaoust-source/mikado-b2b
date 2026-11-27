import test from "node:test";
import assert from "node:assert/strict";
import { lineSchema } from "../app/domain/quote";
import { proBilling, proPrice, publicUnitPrice } from "../app/domain/pro";

const line = (id: string, price: number, extra: object = {}) =>
  lineSchema.parse({ id, name: id, qty: 1, price, discount: 0, vatRate: 21, sourcePrice: price, ...extra });

function quote(deliveryPercent: number | null) {
  return {
    groups: [
      { id: "g1", selected: "a", items: [line("a", 1111)] },
      { id: "g2", selected: "b", items: [line("b", 1111)] },
    ],
    extras: [
      // Prestation (sans parent) : hors marchandise, hors livraison.
      { ...line("menuisier", 50000), selected: true },
      ...(deliveryPercent === null
        ? []
        : [{ ...line("liv", 0, { chargePercent: deliveryPercent }), deliveryFee: true, selected: true }]),
    ],
  };
}

test("arrondi : prix pro ligne par ligne, comme à l'écran (11,11 € × 2, 12 %)", () => {
  const b = proBilling(quote(null), 12);
  const shown = [1111, 1111].map((c) => proPrice(c, 12));
  assert.deepEqual(shown, [978, 978]);
  assert.equal(b.merchandisePro, 1956);
  assert.equal(b.merchandisePublic, 2222);
  assert.equal(b.net, 1956);
  assert.equal(b.tax, 411); // 21 % de 19,56 = 4,1076
  assert.equal(b.gross, 2367);
});

test("livraison 3 % et 5 % sur la marchandise remisée, hors prestations", () => {
  const five = proBilling(quote(5), 12);
  assert.equal(five.delivery, 98); // 5 % de 19,56 = 0,978
  assert.equal(five.net, 1956 + 98);
  assert.equal(five.tax, Math.round((2054 * 21) / 100));
  assert.equal(five.gross, 2054 + 431);
  const three = proBilling(quote(3), 12);
  assert.equal(three.delivery, 59); // 3 % de 19,56 = 0,5868
  assert.equal(three.net, 2015);
  assert.equal(three.gross, 2015 + 423);
});

test("prix public TVAC du catalogue ramené HTVA avant la remise", () => {
  const l = line("c", 0, { sourcePrice: 1344, sourceIncludesTax: true, sourceVatRate: 21 });
  assert.equal(publicUnitPrice(l), 1111);
  const b = proBilling({ groups: [{ id: "g", selected: "c", items: [l] }], extras: [] }, 12);
  assert.equal(b.merchandisePro, 978);
});
