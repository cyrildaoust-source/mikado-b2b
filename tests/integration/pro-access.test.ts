import test from "node:test";
import assert from "node:assert/strict";
import db from "../../app/db.server";
import { emptyQuote } from "../../app/domain/quote";
import {
  assertQuoteAccess,
  createQuote,
  getQuote,
  listQuotes,
} from "../../app/services/quotes.server";
import {
  acceptInvite,
  createInvite,
  findInvite,
  verifyPassword,
} from "../../app/services/auth.server";
import { addToQuote, openQuotes } from "../../app/services/catalog-quote.server";
import { demoProducts } from "../../app/services/catalog.server";

const shop = "pro-test.myshopify.com";

test("chaque architecte ne voit que ses devis ; Mikado Deco voit tout", async () => {
  const a = await db.user.create({ data: { email: "a@test.be", name: "A" } }),
    b = await db.user.create({ data: { email: "b@test.be", name: "B" } });
  const qa = await createQuote(shop, { ...emptyQuote(), project: "Projet A" }, a.id),
    qb = await createQuote(shop, { ...emptyQuote(), project: "Projet B" }, b.id);
  assert.deepEqual(
    (await listQuotes(shop, "", "all", 1, a.id)).quotes.map((q) => q.id),
    [qa.id],
  );
  assert.equal((await listQuotes(shop, "", "all", 1, null)).total, 2);
  await assertQuoteAccess(shop, qa.id, a.id);
  await assertQuoteAccess(shop, qb.id, null);
  await assert.rejects(
    () => assertQuoteAccess(shop, qb.id, a.id),
    (e: unknown) => e instanceof Response && e.status === 404,
  );
  assert.deepEqual(
    (await openQuotes(shop, a.id)).map((q) => q.id),
    [qa.id],
  );
  // Ajouter au devis d'une autre architecte est refusé.
  const product = demoProducts[0];
  await assert.rejects(() =>
    addToQuote({
      shop,
      admin: null,
      owner: a.id,
      ownerId: a.id,
      product,
      variantId: product.productVariants[0].id,
      qty: 1,
      quoteId: qb.id,
    }),
  );
  const id = await addToQuote({
    shop,
    admin: null,
    owner: a.id,
    ownerId: a.id,
    product,
    variantId: product.productVariants[1].id,
    qty: 3,
    quoteId: qa.id,
  });
  const state = JSON.parse((await getQuote(shop, id)).state);
  assert.equal(state.groups.length, 1);
  assert.equal(state.groups[0].items[0].qty, 3);
  assert.equal(state.groups[0].items[0].price, product.productVariants[1].price);
  // Un nouveau devis créé depuis le catalogue appartient à l'architecte.
  const fresh = await addToQuote({
    shop,
    admin: null,
    owner: a.id,
    ownerId: a.id,
    product,
    variantId: product.productVariants[0].id,
    qty: 1,
    quoteId: "new",
  });
  assert.equal((await getQuote(shop, fresh)).ownerId, a.id);
  // Une finition d'un autre produit est refusée.
  await assert.rejects(() =>
    addToQuote({
      shop,
      admin: null,
      owner: a.id,
      ownerId: a.id,
      product,
      variantId: demoProducts[1].productVariants[0].id,
      qty: 1,
      quoteId: qa.id,
    }),
  );
});

test("une invitation sert une seule fois et fixe le mot de passe", async () => {
  const u = await db.user.create({ data: { email: "c@test.be", name: "C" } });
  const token = await createInvite(u.id);
  assert.ok(await findInvite(token));
  await assert.rejects(() => acceptInvite(token, "court"));
  await acceptInvite(token, "mot-de-passe-solide");
  assert.equal(await findInvite(token), null);
  await assert.rejects(() => acceptInvite(token, "mot-de-passe-solide"));
  const stored = await db.user.findUnique({ where: { id: u.id } });
  assert.equal(await verifyPassword("mot-de-passe-solide", stored!.passwordHash), true);
  // Un accès retiré rend ses liens inutilisables.
  const again = await createInvite(u.id);
  await db.user.update({ where: { id: u.id }, data: { active: false } });
  assert.equal(await findInvite(again), null);
});
