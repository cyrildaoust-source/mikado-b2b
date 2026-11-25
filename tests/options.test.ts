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
