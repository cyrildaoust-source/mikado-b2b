import test from "node:test";
import assert from "node:assert/strict";
import { dropOnQuote } from "../app/domain/move";
import {
  emptyQuote,
  fiscalTotals,
  lineSchema,
  optionsOf,
  quoteSchema,
  removeLine,
  repriceExtras,
  setChargeMode,
  setDeliveryFee,
  services,
  type QuoteState,
} from "../app/domain/quote";
import {
  addLineToState,
  parsePlacement,
} from "../app/services/catalog-quote.server";

const line = (id: string, price = 10000) =>
  lineSchema.parse({ id, name: id, qty: 1, price, discount: 0, vatRate: 21 });

function quote(): QuoteState {
  return quoteSchema.parse({
    ...emptyQuote(),
    groups: [
      { id: "g1", sectionId: "salon", section: "Salon", selected: "a", items: [line("a")] },
      { id: "g2", sectionId: "salon", section: "Salon", selected: "b", items: [line("b")] },
    ],
    extras: [
      { ...line("opt", 5000), selected: false, parent: "g1" },
      { ...line("menuisier", 20000), selected: true },
    ],
  });
}

test("une option rattachée reste sous son produit et hors total tant qu'elle n'est pas cochée", () => {
  const s = quote();
  assert.deepEqual(optionsOf(s, "g1").map((e) => e.id), ["opt"]);
  assert.deepEqual(services(s).map((e) => e.id), ["menuisier"]);
  assert.equal(fiscalTotals(s).net, 10000 + 10000 + 20000);
  const included = quoteSchema.parse({
    ...s,
    extras: s.extras.map((e) => (e.id === "opt" ? { ...e, selected: true } : e)),
  });
  assert.equal(fiscalTotals(included).net, 45000);
});

test("retirer un produit retire ses options, pas les prestations", () => {
  const s = removeLine(quote(), "a");
  assert.deepEqual(s.extras.map((e) => e.id), ["menuisier"]);
});

test("un produit fondu dans un autre lui transmet ses options", () => {
  const s = dropOnQuote(
    quote(),
    { kind: "group", groupId: "g1" },
    { kind: "group", groupId: "g2" },
  );
  assert.deepEqual(optionsOf(s, "g2").map((e) => e.id), ["opt"]);
});

test("depuis la fiche produit, « option:<groupe> » rattache l'option au produit", () => {
  assert.deepEqual(parsePlacement("option:g2"), { kind: "option", group: "g2" });
  const s = addLineToState(quote(), line("coussin", 3000), 2, parsePlacement("option:g2"), "c1");
  const added = s.extras.find((e) => e.id === "c1")!;
  assert.equal(added.parent, "g2");
  assert.equal(added.selected, false);
  assert.equal(added.qty, 2);
  assert.throws(() => addLineToState(quote(), line("x"), 1, parsePlacement("option:absent")));
});

test("la livraison à 5 % compte les options cochées, pas celles hors total ni les prestations", () => {
  const s = setDeliveryFee(quote(), true, "liv");
  const fee = (q: QuoteState) => q.extras.find((e) => e.deliveryFee)!.price;
  assert.equal(fee(s), 1000);
  const included = repriceExtras({
    ...s,
    extras: s.extras.map((e) => (e.id === "opt" ? { ...e, selected: true } : e)),
  });
  assert.equal(fee(included), 1250);
  // La validation du devis (enregistrement, PDF) recalcule de la même façon.
  assert.equal(fee(quoteSchema.parse(included)), 1250);
});

test("une prestation repassée en montant fixe retrouve son montant, pas le montant calculé", () => {
  let s = quote();
  s = {
    ...s,
    extras: s.extras.map((e) =>
      e.id === "menuisier" ? { ...e, price: 38000, qty: 2, discount: 10 } : e,
    ),
  };
  const percent = setChargeMode(s, "menuisier", "percent");
  const p = percent.extras.find((e) => e.id === "menuisier")!;
  assert.equal(p.chargePercent, 5);
  assert.equal(p.price, 1000); // 5 % de 200,00 €
  const back = setChargeMode(quoteSchema.parse(percent), "menuisier", "fixed");
  const f = back.extras.find((e) => e.id === "menuisier")!;
  assert.equal(f.chargePercent, null);
  assert.deepEqual([f.price, f.qty, f.discount], [38000, 2, 10]);
  assert.equal(f.priceConfirmed, true);
  assert.equal(f.fixed, undefined);
});

test("sans montant mis de côté, le retour en montant fixe repart de zéro, à confirmer", () => {
  const s = quote();
  const old = repriceExtras({
    ...s,
    extras: s.extras.map((e) =>
      e.id === "menuisier" ? { ...e, chargePercent: 5 } : e,
    ),
  });
  const f = setChargeMode(old, "menuisier", "fixed").extras.find(
    (e) => e.id === "menuisier",
  )!;
  assert.deepEqual([f.price, f.qty, f.priceConfirmed], [0, 1, false]);
});
