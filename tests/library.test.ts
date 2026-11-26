import { test } from "node:test";
import assert from "node:assert/strict";
import { groupLibrary, libraryLabel, matchLibrary, parseSwatchName } from "../app/domain/library";
import { boardSchema } from "../app/domain/moodboard";

test("nom de fichier : collection et coloris", () => {
  const cases: [string, string, string][] = [
    ["Hallingdal 65 - 130.jpg", "Hallingdal 65", "130"],
    ["Hallingdal_65_0130.jpg", "Hallingdal 65", "0130"],
    ["Remix 3 0123.png", "Remix 3", "0123"],
    ["Steelcut Trio 3 - 0105.JPG", "Steelcut Trio 3", "0105"],
    ["Divina MD 0193.webp", "Divina MD", "0193"],
    ["Hallingdal 65.jpg", "Hallingdal 65", ""],
    ["Lin naturel.jpg", "Lin naturel", ""],
  ];
  for (const [file, collection, colour] of cases)
    assert.deepEqual(parseSwatchName(file), { collection, colour }, file);
});

test("bibliothèque : tri, groupes, recherche, libellé", () => {
  const m = (maker: string, collection: string, colour: string) => ({
    id: `${maker}${collection}${colour}`, maker, collection, colour, width: 10, height: 10,
  });
  const items = [m("Kvadrat", "Remix 3", "0123"), m("Dedar", "Tiger Mountain", "001"), m("Kvadrat", "Hallingdal 65", "130"), m("Kvadrat", "Hallingdal 65", "0110")];
  const groups = groupLibrary(items);
  assert.deepEqual(groups.map((g) => g.maker), ["Dedar", "Kvadrat"]);
  assert.deepEqual(groups[1].items.map((i) => i.colour), ["0110", "130", "0123"]);
  assert.ok(matchLibrary(items[2], "hallingdal 130"));
  assert.ok(matchLibrary(items[0], "kvadrat remix"));
  assert.ok(!matchLibrary(items[0], "hallingdal"));
  assert.equal(libraryLabel(items[2]), "Hallingdal 65 – 130");
});

test("planche : une matière de la bibliothèque est admise, une adresse libre non", () => {
  const item = (src: string) => ({
    key: "k", background: "#ffffff",
    items: [{ id: "a", kind: "material", src, ratio: 1, x: 0, y: 0, w: 0.1, h: 0.1, name: "Hallingdal 65", maker: "Kvadrat", reference: "130" }],
  });
  assert.ok(boardSchema.safeParse(item("library:clx1234567890abcdef")).success);
  assert.ok(!boardSchema.safeParse(item("library:../../etc")).success);
  assert.ok(!boardSchema.safeParse(item("https://www.kvadrat.dk/x.jpg")).success);
});

test("Kvadrat : produit saisi et coloris du pack d'images", async () => {
  const { parseKvadratProduct, kvadratColour } = await import("../app/domain/library");
  assert.deepEqual(parseKvadratProduct("1000"), { number: "1000", collection: "" });
  assert.deepEqual(
    parseKvadratProduct("https://www.kvadrat.dk/en/products/upholstery/1000-hallingdal-65"),
    { number: "1000", collection: "Hallingdal 65" },
  );
  assert.deepEqual(parseKvadratProduct("https://kvadrat.dk/products/1000?colorway=0130"), { number: "1000", collection: "" });
  assert.equal(parseKvadratProduct("Hallingdal"), null);
  assert.equal(kvadratColour("Hallingdal 65/1000_0130.jpg", "1000"), "0130");
  assert.equal(kvadratColour("1000-130-hallingdal.jpg", "1000"), "130");
  assert.equal(kvadratColour("hallingdal-ambiance.jpg", "1000"), "");
});
