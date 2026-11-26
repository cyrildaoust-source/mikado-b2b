import test from "node:test";
import assert from "node:assert/strict";
import { emptyQuote, fiscalTotals, lineSchema, setDeliveryFee } from "../app/domain/quote";
import { applyChoices, initialChoices } from "../app/domain/proposal";

const line = (id: string, price: number) =>
  lineSchema.parse({ id, name: id, qty: 1, price, discount: 0, vatRate: 21 });

function quote() {
  let s = emptyQuote();
  s.schemaVersion = 2;
  s.groups = [
    { id: "g", section: "Salon", sectionId: "s", selected: "a", syncQty: true,
      items: [line("a", 100000), line("b", 80000)] },
  ];
  s.extras = [
    { ...line("opt", 20000), selected: false, parent: "g" },
    { ...line("pose", 15000), selected: true },
  ];
  s = setDeliveryFee(s, true, "liv", 5);
  return s;
}

test("choix du client : l'alternative et l'option recalculent la livraison", () => {
  const s = quote();
  const base = fiscalTotals(applyChoices(s, {}));
  // 1 000 + 150 (prestation) + 5 % de 1 000 (50) = 1 200 HTVA
  assert.equal(base.net, 120000);
  const alt = fiscalTotals(applyChoices(s, { groups: { g: "b" }, options: { opt: true } }));
  // 800 + 200 option + 150 + 5 % de 1 000 (50) = 1 200 HTVA
  assert.equal(alt.net, 120000);
  const altOnly = fiscalTotals(applyChoices(s, { groups: { g: "b" } }));
  assert.equal(altOnly.net, 80000 + 15000 + 4000);
});

test("choix du client : rien d'autre ne bouge", () => {
  const s = quote();
  const r = applyChoices(s, {
    groups: { g: "inconnu", autre: "a" },
    options: { pose: false, liv: false, opt: true },
  });
  assert.equal(r.groups[0].selected, "a");
  assert.equal(r.extras.find((e) => e.id === "pose")!.selected, true);
  assert.equal(r.extras.find((e) => e.deliveryFee)!.selected, true);
  assert.equal(r.extras.find((e) => e.id === "opt")!.selected, true);
  assert.deepEqual(initialChoices(s), { groups: { g: "a" }, options: { opt: false } });
});
