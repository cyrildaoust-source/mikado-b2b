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
