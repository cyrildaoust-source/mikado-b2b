import { test } from "node:test";
import assert from "node:assert/strict";
import { dedarCollection, dedarProductSlugs, dedarSwatches } from "../app/domain/dedar";

test("Dedar : coloris lus sur la fiche", () => {
  const html = `
    <img src="https://cdn.dedar.com/bc-swatch-22815-c82857da.jpg?format=auto&amp;width=1800" alt="Acacia 012" loading="lazy">
    <img alt="Acacia 001" class="x" src="https://cdn.dedar.com/bc-swatch-22792-aa9b10aa.jpg?width=16&amp;blur=3&amp;format=auto">
    <img alt="Acacia 001" src="https://cdn.dedar.com/bc-swatch-22792-aa9b10aa.jpg?format=auto&amp;width=1800">
    <img src="https://cdn.dedar.com/bc-gallery-778514-ee73cc6f.jpg?width=1800" alt="Acacia ambiance">
    <img src="https://cdn.dedar.com/bc-swatch-1-ab.jpg" alt="">`;
  const s = dedarSwatches(html);
  assert.deepEqual(s, [
    { name: "Acacia", colour: "012", src: "https://cdn.dedar.com/bc-swatch-22815-c82857da.jpg" },
    { name: "Acacia", colour: "001", src: "https://cdn.dedar.com/bc-swatch-22792-aa9b10aa.jpg" },
  ]);
  assert.equal(dedarCollection(s, "acacia"), "Acacia");
  assert.equal(dedarCollection([], "tiger-mountain"), "Tiger Mountain");
});

test("Dedar : fiches du plan du site", () => {
  const xml = `<url><loc>https://dedar.com/products/abaca/</loc></url><url><loc>https://dedar.com/products/anna/</loc></url><url><loc>https://dedar.com/journal/x/</loc></url>`;
  assert.deepEqual(dedarProductSlugs(xml), ["abaca", "anna"]);
});

test("Dedar : coloris cachés dans la charge Nuxt", async () => {
  const { dedarAllSwatches, unflattenPayload } = await import("../app/domain/dedar");
  // Racine → { variants: [v1, v2, v3], related: [r1] } ; chaque variante → { name, image: { url } }.
  const flat = [
    ["ShallowReactive", 1],
    { variants: 2, related: 12 },
    [3, 6, 9],
    { name: 4, image: 5 },
    "Acacia 012",
    { url: 15 },
    { name: 7, image: 8 },
    "Acacia 020",
    { url: 16 },
    { code: 10, title: 18, image: 11 },
    "031",
    { url: 17 },
    [13],
    { name: 14, image: 19 },
    "Other 001",
    "https://cdn.dedar.com/bc-swatch-1-aa.jpg",
    "https://cdn.dedar.com/bc-swatch-2-bb.jpg",
    "https://cdn.dedar.com/bc-swatch-3-cc.jpg",
    "Acacia",
    { url: 20 },
    "https://cdn.dedar.com/bc-swatch-9-dd.jpg",
  ];
  assert.ok(unflattenPayload(flat));
  const html = `<img src="https://cdn.dedar.com/bc-swatch-1-aa.jpg?width=10" alt="Acacia 012">
    <script type="application/json" data-nuxt-data="nuxt-app" id="__NUXT_DATA__">${JSON.stringify(flat)}</script>`;
  assert.deepEqual(
    dedarAllSwatches(html).map((s) => `${s.name} ${s.colour}`),
    ["Acacia 012", "Acacia 020", "Acacia 031"],
  );
});

test("Dedar : variantes du produit de la page, avec teinte et grande photo", async () => {
  const { dedarAllSwatches } = await import("../app/domain/dedar");
  const flat = [
    { entry: 1 },
    { slug: 2, title: 3, variants: 4 },
    "acacia",
    "Acacia",
    [5, 11],
    { code: 6, color: 7, swatch: 8, imagesBc: 9 },
    "012",
    "rose indien",
    { url: 10 },
    [12],
    "https://cdn.dedar.com/bc-swatch-1-aa.jpg",
    { code: 13, swatch: 14 },
    "https://cdn.dedar.com/bc-variant-19445-c54df3fa.jpg",
    "001",
    { url: 15 },
    "https://cdn.dedar.com/bc-swatch-2-bb.jpg",
  ];
  const html = `<script id="__NUXT_DATA__" type="application/json">${JSON.stringify(flat)}</script>`;
  assert.deepEqual(dedarAllSwatches(html, "acacia"), [
    { name: "Acacia", colour: "012", src: "https://cdn.dedar.com/bc-swatch-1-aa.jpg", image: "https://cdn.dedar.com/bc-variant-19445-c54df3fa.jpg", tint: "rose indien" },
    { name: "Acacia", colour: "001", src: "https://cdn.dedar.com/bc-swatch-2-bb.jpg" },
  ]);
});

test("Rubelli : liste et coloris d'une fiche", async () => {
  const { rubelliListing, rubelliColours, rubelliReplaced, RUBELLI_IMAGE } = await import("../app/domain/rubelli");
  const list = `<a href="https://www.rubelli.com/en/ola-30719">x</a><a href="https://www.rubelli.com/en/ola-30719">y</a>
    <a href="https://www.rubelli.com/en/masavi-17309">z</a><a href="https://www.rubelli.com/en/textiles?p=8">n</a>`;
  assert.deepEqual(rubelliListing(list), ["ola-30719", "masavi-17309"]);
  const page = `<title>Ombra</title>
    <img src="https://cdn.rubelli.com/A762_001/762_1.840x840c.jpg" alt="Ombra">
    <img src="https://cdn.rubelli.com/A762_001/762_1.84x84c.jpg" alt="Ombra - Celeste">
    <img alt="Ombra&#x20;-&#x20;Nuvola" data-src="https://cdn.rubelli.com/A762_002/762_2.84x84c.jpg">
    <img src="https://cdn.rubelli.com/A762_040/762_40.84x84c.jpg" alt="Ombra - Panna">`;
  const c = rubelliColours(page);
  assert.deepEqual(c.map((x) => `${x.collection}|${x.colour}`), ["Ombra|1 Celeste", "Ombra|2 Nuvola", "Ombra|40 Panna"]);
  assert.ok(c.every((x) => RUBELLI_IMAGE.test(x.image)));
  assert.equal(c[2].image, "https://cdn.rubelli.com/A762_040/762_40.840x840c.jpg");
  assert.ok(rubelliReplaced("<title>Ombra. Replaced by 30253.</title>"));
});

test("Designers Guild : cartes du catalogue, collection et teinte", async () => {
  const { dgCards, dgColours, DG_IMAGE } = await import("../app/domain/designersguild");
  const html = `<ul class="grid"><li class="card">
  <div class="img"><span class="new">New</span><img src="assets/img/fabric/178365.webp" alt="Pavin Delft fabric"></div>
  <h3>Pavin Delft</h3><p class="type">Fabric</p><p class="meta">FDG3301/03</p>
</li><li class="card"><div class="img"><img src="assets/img/fabric/178357.webp" alt=""></div>
  <h3>Pavin Noir</h3><p class="meta">FDG3301/01</p>
</li><li class="card"><div class="img"><img src="assets/img/fabric/1.webp" alt=""></div>
  <h3>Brera Lino Duck Egg</h3><p class="meta">F1723/12</p>
</li><li class="card"><div class="img"><img src="assets/img/fabric/2.webp" alt=""></div>
  <h3>Brera Lino Chalk</h3><p class="meta">F1723/01</p></li></ul>`;
  const cards = dgCards(html);
  assert.equal(cards.length, 4);
  assert.ok(cards.every((c) => DG_IMAGE.test(c.image)));
  assert.deepEqual(dgColours(cards).map((c) => `${c.collection}|${c.colour}`), [
    "Pavin|03 Delft",
    "Pavin|01 Noir",
    "Brera Lino|12 Duck Egg",
    "Brera Lino|01 Chalk",
  ]);
});

test("Élitis : collections et coloris lus dans l'API", async () => {
  const { elitisCollections, elitisColours, ELITIS_IMAGE } = await import("../app/domain/elitis");
  const tree = [
    { name: "L'Accessoire", slug: "accessoire", children: [{ name: "Alba", slug: "alba" }] },
    { name: "Tissu", slug: "tissu", children: [{ name: "Faro", slug: "faro" }, { name: "Off", slug: "off", enabled: false }, { name: "Bad", slug: "../x" }] },
    { name: "In-Outdoor", slug: "outdoor", children: [{ name: "Faro", slug: "faro" }, { name: "Faro", slug: "outdoor-faro" }] },
  ];
  assert.deepEqual(elitisCollections(tree), [
    { category: "Tissu", name: "Faro", slug: "faro" },
    { category: "In-Outdoor", name: "Faro", slug: "outdoor-faro" },
  ]);
  const colours = elitisColours({
    items: [
      { code: "OD_154_15", name: "Souvenir du jardin", images: [{ code: "complet", path: "b0/bb/b.jpg" }, { code: "main", path: "c7/73/outdoor-nossa-od-154-15-990e.jpg" }] },
      { code: "X_1", name: "Sans image", images: [] },
      { code: "X_2", name: "Chemin douteux", images: [{ code: "main", path: "../../etc.jpg" }] },
    ],
  });
  assert.deepEqual(colours, [{ colour: "OD_154_15 Souvenir du jardin", image: "https://d1znk9ex7ihxii.cloudfront.net/media/cache/square_big/c7/73/outdoor-nossa-od-154-15-990e.jpg" }]);
  assert.ok(ELITIS_IMAGE.test(colours[0].image));
  assert.equal(ELITIS_IMAGE.test("https://evil.example/media/cache/square_big/c7/73/a.jpg"), false);
});
