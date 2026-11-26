import test from "node:test";
import assert from "node:assert/strict";
import db from "../../app/db.server";
import { emptyQuote, type QuoteState } from "../../app/domain/quote";
import { demoLines } from "../../app/services/shopify-api.server";
import { createQuote, saveQuote } from "../../app/services/quotes.server";
import { publishQuote } from "../../app/services/conversion.server";
import { saveFirm } from "../../app/services/firm.server";
import {
  activeShare,
  createShare,
  hashToken,
  resolveShare,
  revokeShares,
} from "../../app/services/share.server";

const shop = `share-${Date.now()}.local`;

function state(price = demoLines[0].price): QuoteState {
  const s = emptyQuote();
  s.client = "Anne Dupont";
  s.groups = [
    {
      id: "g",
      syncQty: true,
      sectionId: "s",
      section: "Salon",
      selected: "a",
      items: [{ ...demoLines[0], id: "a", price }],
    },
  ];
  return s;
}

async function ready(id: number, version: number) {
  await publishQuote(shop, id, version, null);
  await db.revision.update({
    where: { quoteId_version: { quoteId: id, version } },
    data: { pdfGeneratedAt: new Date(), pdf: Buffer.from("pdf") },
  });
}

test("lien en ligne : au nom du cabinet, prix figés, un seul lien actif", async () => {
  const u = await db.user.create({
    data: { email: `archi-${Date.now()}@test.be`, name: "Archi", role: "architect" },
  });
  const q = await createQuote(shop, state(), u.id);
  // Sans fiche cabinet complète, pas de révision au nom de Mikado Deco.
  await assert.rejects(() => publishQuote(shop, q.id, 1, null), /Mon cabinet/);
  await saveFirm(u.id, {
    name: "Atelier Test",
    address: "Rue Test 1, 1180 Uccle",
    vat: "BE0123456789",
    phone: "",
    email: "",
    website: "",
  });
  await ready(q.id, 1);
  await assert.rejects(() => createShare(shop, q.id, 2, u.id), /changé/);

  const first = await createShare(shop, q.id, 1, u.id);
  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
  const row = await db.quoteShare.findFirstOrThrow({ where: { quoteId: q.id } });
  assert.equal(row.tokenHash, hashToken(first.token));
  assert.ok(!JSON.stringify(row).includes(first.token), "jeton jamais en base");

  const open = await resolveShare(first.token);
  assert.equal(open.status, "open");
  if (open.status !== "open") return;
  assert.equal(open.seller?.name, "Atelier Test");
  assert.equal(open.seller?.kind, "firm");
  assert.equal(open.seller?.email, "", "pas d'e-mail Mikado sur l'offre du cabinet");
  const frozen = open.state.groups[0].items[0].price;

  // Le brouillon change : le lien garde la révision figée.
  await saveQuote(shop, q.id, 1, state(frozen + 5000));
  const again = await resolveShare(first.token);
  assert.equal(again.status === "open" && again.state.groups[0].items[0].price, frozen);
  assert.equal((await activeShare(q.id))?.views, 2);
  assert.equal((await activeShare(q.id))?.version, 1);

  // Un nouveau lien retire l'ancien.
  await ready(q.id, 2);
  const second = await createShare(shop, q.id, 2, u.id);
  assert.equal((await resolveShare(first.token)).status, "closed");
  assert.equal((await resolveShare(second.token)).status, "open");
  assert.equal(await db.quoteShare.count({ where: { quoteId: q.id, revokedAt: null } }), 1);

  await revokeShares(shop, q.id);
  assert.equal((await resolveShare(second.token)).status, "closed");
  assert.equal(await activeShare(q.id), null);
  assert.equal((await resolveShare("x".repeat(43))).status, "unknown");
  assert.equal((await resolveShare("../../etc")).status, "unknown");

  // Expiré : le lien dit pourquoi il ne s'ouvre plus.
  const third = await createShare(shop, q.id, 2, u.id);
  await db.quoteShare.updateMany({
    where: { quoteId: q.id, revokedAt: null },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  assert.equal((await resolveShare(third.token)).status, "expired");
});

test("devis de Mikado Deco : émis au nom de Mikado Deco, sans fiche cabinet", async () => {
  const q = await createQuote(shop, state());
  await ready(q.id, 1);
  const { token } = await createShare(shop, q.id, 1, null);
  const open = await resolveShare(token, false);
  assert.equal(open.status === "open" && open.seller?.kind, "mikado");
});
