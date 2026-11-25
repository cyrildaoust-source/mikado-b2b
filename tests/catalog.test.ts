import test from "node:test";
import assert from "node:assert/strict";
import {
  catalogQuery,
  isVisible,
  netPrice,
  visibilityQuery,
  demoProducts,
} from "../app/services/catalog.server";
import { addLineToState } from "../app/services/catalog-quote.server";
import {
  hashPassword,
  passwordProblem,
  safeNext,
  verifyPassword,
} from "../app/services/auth.server";
import { emptyQuote, lineSchema, selectedLines } from "../app/domain/quote";
import { sized } from "../app/components/catalog/image";

test("sans réglage, les fiches actives et en brouillon sont visibles, jamais les archivées", () => {
  assert.equal(visibilityQuery([]), "(((status:active OR status:draft)))");
  assert.equal(isVisible({ vendor: "HAY", status: "ACTIVE" }, []), true);
  assert.equal(isVisible({ vendor: "HAY", status: "DRAFT" }, []), true);
  assert.equal(isVisible({ vendor: "HAY", status: "ARCHIVED" }, []), false);
});

test("une marque masquée disparaît entièrement", () => {
  const rules = [
    { vendor: "IHR", visible: false },
    { vendor: "Knoll", visible: true },
    { vendor: 'Carl Hansen & "Søn"', visible: false },
  ];
  assert.equal(
    visibilityQuery(rules),
    '(((status:active OR status:draft) AND -vendor:"IHR" AND -vendor:"Carl Hansen & \\"Søn\\""))',
  );
  assert.equal(isVisible({ vendor: "IHR", status: "ACTIVE" }, rules), false);
  assert.equal(isVisible({ vendor: "IHR", status: "DRAFT" }, rules), false);
  assert.equal(isVisible({ vendor: "Knoll", status: "DRAFT" }, rules), true);
  assert.equal(isVisible({ vendor: "Knoll", status: "ARCHIVED" }, rules), false);
});

test("le catalogue par variante filtre sur le statut du produit", () => {
  assert.equal(
    visibilityQuery([{ vendor: "IHR", visible: false }], "product_status"),
    '(((product_status:active OR product_status:draft) AND -vendor:"IHR"))',
  );
});

test("les filtres s'ajoutent à la visibilité sans pouvoir l'élargir", () => {
  const q = catalogQuery([], {
    vendors: ["Vitra", "Hay"],
    type: "Chaises",
    q: "eames OR status:archived",
  });
  assert.ok(q.startsWith("(((status:active OR status:draft))) AND "));
  assert.match(q, /\(vendor:"Vitra" OR vendor:"Hay"\)/);
  assert.match(q, /product_type:"Chaises"/);
  assert.doesNotMatch(q, /status:archived/);
});

test("plusieurs familles se combinent en OU", () => {
  const q = catalogQuery([], { types: ["Chaises", "Tables"] });
  assert.match(q, /\(product_type:"Chaises" OR product_type:"Tables"\)/);
});

test("prix public HTVA depuis un catalogue TVAC", () => {
  assert.equal(netPrice("121.00", true), 10000);
  assert.equal(netPrice("100.00", false), 10000);
});

test("ajouter une finition crée une ligne retenue, sans toucher aux autres", () => {
  const line = lineSchema.parse({
    id: "x",
    name: "Chaise",
    qty: 1,
    price: 20000,
    discount: 0,
    vatRate: 21,
  });
  const once = addLineToState(emptyQuote(), line, 4);
  const twice = addLineToState(once, line, 1);
  assert.equal(twice.groups.length, 2);
  assert.notEqual(twice.groups[0].items[0].id, twice.groups[1].items[0].id);
  assert.equal(twice.groups[0].sectionId, twice.groups[1].sectionId);
  assert.deepEqual(
    selectedLines(twice).map((l) => l.qty),
    [4, 1],
  );
});

test("la démonstration a des brouillons pour tester le réglage des marques", () => {
  assert.ok(demoProducts.some((p) => p.status === "DRAFT"));
  assert.equal(new Set(demoProducts.map((p) => p.numericId)).size, demoProducts.length);
});

test("mot de passe haché et vérifié", async () => {
  const stored = await hashPassword("un-mot-de-passe-long");
  assert.match(stored, /^scrypt\$/);
  assert.equal(await verifyPassword("un-mot-de-passe-long", stored), true);
  assert.equal(await verifyPassword("autre-mot-de-passe", stored), false);
  assert.equal(await verifyPassword("x", null), false);
  assert.equal(await verifyPassword("x", "bcrypt$a$b"), false);
  assert.ok(passwordProblem("court"));
  assert.equal(passwordProblem("assez-long-ici"), null);
});

test("la redirection après connexion reste dans l'outil", () => {
  assert.equal(safeNext("/app/quotes/3"), "/app/quotes/3");
  assert.equal(safeNext("/app"), "/app");
  assert.equal(safeNext("//evil.example/app"), "/app/catalogue");
  assert.equal(safeNext("https://evil.example"), "/app/catalogue");
  assert.equal(safeNext("/application"), "/app/catalogue");
});

test("les photos Shopify sont demandées à la bonne taille", () => {
  assert.equal(
    sized("https://cdn.shopify.com/s/files/a.jpg?v=1", 600),
    "https://cdn.shopify.com/s/files/a.jpg?v=1&width=600",
  );
  assert.equal(sized("data:image/svg+xml,abc", 600), "data:image/svg+xml,abc");
  assert.equal(sized("https://example.com/a.jpg", 600), "https://example.com/a.jpg");
});
