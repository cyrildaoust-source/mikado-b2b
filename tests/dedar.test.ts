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
