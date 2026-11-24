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

test("sans réglage, seules les fiches actives sont visibles", () => {
  assert.equal(visibilityQuery([]), "((status:active))");
  assert.equal(isVisible({ vendor: "HAY", status: "ACTIVE" }, []), true);
  assert.equal(isVisible({ vendor: "HAY", status: "DRAFT" }, []), false);
  assert.equal(isVisible({ vendor: "HAY", status: "ARCHIVED" }, []), false);
});

test("une marque masquée disparaît, une marque indirecte montre ses brouillons", () => {
  const rules = [
    { vendor: "IHR", visible: false, includeDrafts: true },
    { vendor: "Knoll", visible: true, includeDrafts: true },
    { vendor: 'Carl Hansen & "Søn"', visible: true, includeDrafts: true },
  ];
  assert.equal(
    visibilityQuery(rules),
    '((status:active AND -vendor:"IHR") OR (status:draft AND (vendor:"Knoll" OR vendor:"Carl Hansen & \\"Søn\\"")))',
  );
  assert.equal(isVisible({ vendor: "IHR", status: "ACTIVE" }, rules), false);
  assert.equal(isVisible({ vendor: "IHR", status: "DRAFT" }, rules), false);
  assert.equal(isVisible({ vendor: "Knoll", status: "DRAFT" }, rules), true);
  assert.equal(isVisible({ vendor: "Knoll", status: "ARCHIVED" }, rules), false);
});

test("les filtres s'ajoutent à la visibilité sans pouvoir l'élargir", () => {
  const q = catalogQuery([], {
    vendor: "Vitra",
    type: "Chaises",
    q: "eames OR status:draft",
  });
  assert.ok(q.startsWith("((status:active)) AND "));
  assert.match(q, /vendor:"Vitra"/);
  assert.match(q, /product_type:"Chaises"/);
  assert.doesNotMatch(q, /status:draft/);
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
