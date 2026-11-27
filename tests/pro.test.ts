import test from "node:test";
import assert from "node:assert/strict";
import {
  proPrice,
  publicMerchandise,
  publicUnitPrice,
  shownProPrice,
  lockPrices,
  readPriceView,
  viewPrice,
  displayGross,
} from "../app/domain/pro";

test("prix affiché : cookie du sélecteur, puis ancien interrupteur, puis HTVA", () => {
  assert.equal(readPriceView(null), "htva");
  assert.equal(readPriceView("a=1; prix_affiche=tvac"), "tvac");
  assert.equal(readPriceView("prix_pro=1"), "pro");
  assert.equal(readPriceView("prix_pro=1; prix_affiche=htva"), "htva");
  assert.equal(readPriceView("prix_affiche=autre"), "htva");
});

test("prix affiché : HTVA, pro moins la classe, TVAC à 21 %", () => {
  const pro = { discount: 10, className: "A", show: true };
  assert.deepEqual(viewPrice(10000, "htva", pro), { cents: 10000, kind: "HTVA" });
  assert.equal(viewPrice(10000, "pro", pro).cents, 9000);
  assert.equal(viewPrice(10000, "tvac", pro).cents, 12100);
  assert.equal(viewPrice(10000, "pro", { ...pro, discount: null }).pending, true);
  // Mikado Deco (pas de remise) : la vue pro retombe sur le prix public.
  assert.deepEqual(viewPrice(10000, "pro", null), { cents: 10000, kind: "HTVA" });
});

test("prix pro : prix public moins la remise de classe, HTVA comme TVAC", () => {
  assert.equal(proPrice(100000, 10), 90000);
  assert.equal(proPrice(121000, 10) / 1.21, proPrice(100000, 10));
  assert.equal(proPrice(1999, 12.5), 1749);
  assert.equal(proPrice(5000, 0), 5000);
});

test("prix pro affiché seulement sur demande, « à confirmer » sans classe", () => {
  assert.equal(shownProPrice(null, 1000), null);
  assert.equal(shownProPrice({ discount: 10, className: "A", show: false }, 1000), null);
  assert.equal(shownProPrice({ discount: null, className: null, show: true }, 1000), null);
  assert.equal(shownProPrice({ discount: 10, className: "A", show: true }, 1000), 900);
});

const line = (id: string, price: number, qty = 1, extra = {}) => ({
  id,
  price,
  qty,
  sourcePrice: Math.round(price * 1.21),
  sourceIncludesTax: true,
  sourceVatRate: 21,
  chargePercent: null,
  ...extra,
});

test("prix public d'une ligne : celui du catalogue, même si l'architecte l'a changé", () => {
  assert.equal(publicUnitPrice({ ...line("a", 100000), price: 120000 }), 100000);
  assert.equal(
    publicUnitPrice({ price: 500, sourcePrice: null, sourceIncludesTax: false, sourceVatRate: null }),
    500,
  );
});

test("marchandise : produits retenus et options cochées, sans livraison ni prestations", () => {
  const s = {
    groups: [
      { id: "g1", selected: "a2", items: [line("a1", 50000), line("a2", 100000)] },
      { id: "g2", selected: "b", items: [line("b", 20000, 2)] },
    ],
    extras: [
      { ...line("opt", 10000), selected: true, parent: "g1" },
      { ...line("off", 99999), selected: false, parent: "g1" },
      { ...line("pose", 30000), selected: true },
      { ...line("livraison", 0), selected: true, parent: "g1", chargePercent: 5 },
    ],
  };
  assert.equal(publicMerchandise(s), 100000 + 40000 + 10000);
  assert.equal(proPrice(publicMerchandise(s), 10), 135000);
});

test("architecte : prix du catalogue rétabli, remise client conservée", () => {
  const cat = (price: number, discount: number) => ({
    ...line("c", 100000),
    price,
    discount,
    variantId: "gid://shopify/ProductVariant/1",
    priceConfirmed: true,
  });
  const custom = {
    ...line("p", 30000),
    sourcePrice: null,
    variantId: null,
    discount: 15,
    priceConfirmed: true,
  };
  const s = lockPrices({
    groups: [{ items: [cat(150000, 10)] }],
    extras: [custom],
  });
  assert.equal(s.groups[0].items[0].price, 100000);
  assert.equal(s.groups[0].items[0].discount, 10);
  assert.equal(s.extras[0].price, 30000);
  assert.equal(s.extras[0].discount, 15);
});

test("prix TVAC affiché : le prix de la boutique, pas 54,99 € pour 55 €", () => {
  // Toute la gamme d'un catalogue TVAC en euros ronds : 5 € à 20 000 €.
  for (let gross = 500; gross <= 2_000_000; gross += 100) {
    const net = Math.round(gross / 1.21);
    assert.equal(displayGross(net), gross, `TVAC ${gross / 100} €`);
  }
  assert.equal(viewPrice(Math.round(5500 / 1.21), "tvac", null).cents, 5500);
  // Prix TVAC au centime (49,95 €) : retrouvé lui aussi.
  assert.equal(displayGross(Math.round(4995 / 1.21)), 4995);
  // Un HTVA saisi tel quel reste proche du calcul exact (moins d'un centime).
  assert.ok(Math.abs(displayGross(12345) - 12345 * 1.21) < 1.5);
});
