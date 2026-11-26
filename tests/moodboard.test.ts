import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BOARD_RATIO,
  autoLayout,
  boardSchema,
  fileName,
  keepInside,
  photoHeight,
  resize,
  sized,
} from "../app/domain/moodboard";

const photos = (n: number, ratio = 1) =>
  Array.from({ length: n }, (_, i) => ({
    src: `https://cdn.shopify.com/s/files/p${i}.jpg`,
    alt: `Produit ${i}`,
    ratio,
  }));

test("la disposition automatique garde toutes les photos dans la planche", () => {
  for (const n of [1, 2, 3, 5, 8, 12, 20])
    for (const ratio of [0.5, 1, 1.5, 3]) {
      const b = autoLayout("s1", "Salon", "Projet", photos(n, ratio));
      const imgs = b.items.filter((i) => i.kind === "photo");
      assert.equal(imgs.length, Math.min(n, 12));
      for (const i of imgs) {
        assert.ok(i.x >= 0 && i.y >= 0, `${n}/${ratio} dans la planche`);
        assert.ok(i.x + i.w <= 1.0001 && i.y + i.h <= 1.0001, `${n}/${ratio} ne dépasse pas`);
        assert.ok(Math.abs(i.h - photoHeight(i.w, ratio)) < 1e-9, "proportions gardées");
      }
      assert.ok(boardSchema.safeParse(b).success);
    }
});

test("une photo agrandie garde ses proportions", () => {
  const p = autoLayout("s", "T", "", photos(1, 1.5)).items[1];
  const r = resize(p, 0.5, 0.1);
  assert.equal(r.w, 0.5);
  assert.ok(Math.abs(r.h - (0.5 * BOARD_RATIO) / 1.5) < 1e-9);
});

test("un élément ne sort pas entièrement de la planche", () => {
  const t = autoLayout("s", "T", "", []).items[0];
  const out = keepInside({ ...t, x: 5, y: -5 });
  assert.ok(out.x <= 1 - out.w * 0.25 && out.y >= -out.h * 0.75);
});

test("seules les photos Shopify, de démonstration ou ajoutées sont admises", () => {
  const base = autoLayout("s", "T", "", photos(1)).items[1];
  const ok = (src: string) => boardSchema.safeParse({ key: "s", items: [{ ...base, src }] }).success;
  assert.ok(ok("https://cdn.shopify.com/s/files/x.jpg"));
  assert.ok(ok("upload:clx1234567890abcdef"));
  assert.ok(!ok("https://exemple.com/x.jpg"));
  assert.ok(!ok("javascript:alert(1)"));
});

test("noms de fichiers et tailles d'image", () => {
  assert.equal(fileName("MD-2026-0001", "mood board", "Séjour / cuisine"), "MD-2026-0001 mood board Sejour cuisine");
  assert.match(sized("https://cdn.shopify.com/a.jpg?v=1", 800), /width=800/);
  assert.equal(sized("upload:abc", 800), "upload:abc");
});
