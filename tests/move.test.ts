import test from "node:test";
import assert from "node:assert/strict";
import { dropOnQuote } from "../app/domain/move";
import type { QuoteState } from "../app/domain/quote";

const line = (id: string, qty = 1) =>
  ({
    id,
    name: id,
    qty,
    price: 100,
    discount: 0,
  }) as QuoteState["groups"][number]["items"][number];
const group = (id: string, sectionId: string, ids: string[], qty = 1) => ({
  id,
  sectionId,
  section: sectionId,
  selected: ids[0],
  syncQty: true,
  items: ids.map((i) => line(i, qty)),
});
const state = () =>
  ({
    groups: [
      group("g1", "salon", ["a", "a2"], 2),
      group("g2", "salon", ["b"]),
      group("g3", "cuisine", ["c"]),
    ],
    extras: [],
  }) as unknown as QuoteState;

test("un produit glissé sur une autre pièce y passe, en fin de pièce", () => {
  const s = dropOnQuote(
    state(),
    { kind: "group", groupId: "g1" },
    { kind: "section", sectionId: "cuisine", title: "Cuisine" },
  );
  assert.deepEqual(
    s.groups.map((g) => g.id),
    ["g2", "g3", "g1"],
  );
  assert.equal(s.groups[2].section, "Cuisine");
  assert.equal(s.groups[2].items.length, 2);
});

test("un produit glissé sur un autre devient son alternative, à sa quantité", () => {
  const s = dropOnQuote(
    state(),
    { kind: "group", groupId: "g3" },
    { kind: "group", groupId: "g1" },
  );
  assert.deepEqual(
    s.groups.map((g) => g.id),
    ["g1", "g2"],
  );
  assert.deepEqual(
    s.groups[0].items.map((i) => i.id),
    ["a", "a2", "c"],
  );
  assert.equal(s.groups[0].items[2].qty, 2);
  assert.equal(s.groups[0].selected, "a");
});

test("une alternative sortie vers une pièce devient un produit retenu", () => {
  const s = dropOnQuote(
    state(),
    { kind: "line", lineId: "a2" },
    { kind: "section", sectionId: "cuisine", title: "Cuisine" },
  );
  assert.deepEqual(
    s.groups[0].items.map((i) => i.id),
    ["a"],
  );
  const moved = s.groups.at(-1)!;
  assert.equal(moved.sectionId, "cuisine");
  assert.equal(moved.selected, "a2");
});

test("retirer l'alternative retenue retient la suivante", () => {
  const start = state();
  start.groups[0].selected = "a2";
  const s = dropOnQuote(
    start,
    { kind: "line", lineId: "a2" },
    { kind: "group", groupId: "g2" },
  );
  assert.equal(s.groups[0].selected, "a");
  assert.deepEqual(
    s.groups[1].items.map((i) => i.id),
    ["b", "a2"],
  );
});

test("un dépôt sur soi-même ne change rien", () => {
  const start = state();
  assert.equal(
    dropOnQuote(
      start,
      { kind: "group", groupId: "g1" },
      { kind: "group", groupId: "g1" },
    ),
    start,
  );
  assert.equal(
    dropOnQuote(
      start,
      { kind: "group", groupId: "g1" },
      { kind: "section", sectionId: "salon", title: "salon" },
    ),
    start,
  );
});
