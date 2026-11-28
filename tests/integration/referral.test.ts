import test from "node:test";
import assert from "node:assert/strict";
import db from "../../app/db.server";
import { setMailTransport, type Mail } from "../../app/services/mail.server";
import {
  createReferralRequest,
  dismissRequest,
  ensureReferralCode,
  findReferrer,
  inviteFromRequest,
  referralAdmin,
  referralOverview,
  setReferrer,
} from "../../app/services/referral.server";

const shop = `referral-${Date.now()}.local`;
const mail = () => `r-${Date.now()}-${Math.random()}@test.be`;

async function architect(name = "Claire Parrain") {
  return db.user.create({ data: { email: mail(), name, role: "architect" } });
}

test("lien : un code stable par compte, refusé une fois l'accès retiré", async () => {
  const p = await architect();
  const code = await ensureReferralCode(p.id);
  assert.equal(await ensureReferralCode(p.id), code);
  assert.equal((await findReferrer(code))?.id, p.id);
  assert.equal(await findReferrer("zzzzzzzz"), null);
  await db.user.update({ where: { id: p.id }, data: { active: false } });
  assert.equal(await findReferrer(code), null);
});

test("demande, accès créé, filleul relié et commission sur ses devis", async () => {
  const sent: Mail[] = [];
  setMailTransport(async (m) => {
    sent.push(m);
    return { sent: true, id: "x" };
  });
  try {
    const p = await architect();
    const email = mail();
    const r = await createReferralRequest(
      p,
      { name: "Marc Filleul", firm: "Atelier M", email: email.toUpperCase(), phone: "", message: "" },
      "10.0.0.1",
    );
    assert.equal(r.duplicate, false);
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /Marc Filleul/);
    // Même e-mail : pas de seconde demande ni de second e-mail.
    const again = await createReferralRequest(p, { name: "Marc Filleul", email }, "10.0.0.1");
    assert.equal(again.duplicate, true);
    assert.equal(sent.length, 1);

    let view = await referralOverview(shop, p.id);
    assert.equal(view.filleuls.length, 1);
    assert.equal(view.filleuls[0].stage, "request");

    const admin = await referralAdmin(shop);
    const req = admin.requests.find((x) => x.email === email)!;
    assert.equal(req.referrer.id, p.id);
    const { user, token } = await inviteFromRequest(req.id);
    assert.ok(token.length > 20);
    assert.equal(user.referredById, p.id);
    assert.equal((await db.firmProfile.findUnique({ where: { userId: user.id } }))?.name, "Atelier M");
    await assert.rejects(() => inviteFromRequest(req.id), /déjà traitée/);
    // Un compte existant ne redemande pas d'accès.
    await assert.rejects(() => createReferralRequest(p, { name: "Marc", email }, "10.0.0.2"), /déjà un accès/);

    // Deux devis du filleul : un contresigné, un facturé.
    for (const [status, merchandisePro] of [["signed", 100000], ["invoiced", 50000]] as const) {
      const q = await db.quote.create({
        data: { shop, title: "Projet", customer: "", state: "{}", ownerId: user.id },
      });
      const rev = await db.revision.create({
        data: { quoteId: q.id, version: 1, state: "{}" },
      });
      await db.quoteDecision.create({
        data: {
          quoteId: q.id,
          revisionId: rev.id,
          status,
          choices: "{}",
          clientFirstName: "A",
          clientLastName: "B",
          net: 0,
          tax: 0,
          gross: 0,
          deadline: new Date(),
          architectSignedAt: new Date(),
          billing: JSON.stringify({ kind: "architect", merchandisePro }),
        },
      });
    }
    view = await referralOverview(shop, p.id);
    const f = view.filleuls[0];
    assert.equal(f.stage, "invited");
    assert.equal(f.pending, 2000);
    assert.equal(f.earned, 1000);
    assert.equal(view.pending, 2000);
    assert.equal(view.earned, 1000);
  } finally {
    setMailTransport(null);
  }
});

test("écarter une demande, relier à la main, pas de boucle", async () => {
  setMailTransport(async () => ({ sent: true, id: "x" }));
  try {
    const a = await architect("A");
    const b = await architect("B");
    await createReferralRequest(a, { name: "Zoé", email: mail() }, "");
    const req = (await referralAdmin(shop)).requests.find((r) => r.referrer.id === a.id)!;
    await dismissRequest(req.id);
    await assert.rejects(() => dismissRequest(req.id), /déjà traitée/);

    await setReferrer(b.id, a.id);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: b.id } })).referredById, a.id);
    await assert.rejects(() => setReferrer(a.id, b.id), /boucle/);
    await assert.rejects(() => setReferrer(a.id, a.id), /propre parrain/);
    await setReferrer(b.id, null);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: b.id } })).referredAt, null);
  } finally {
    setMailTransport(null);
  }
});

test("demandes limitées à 5 par heure depuis une même adresse", async () => {
  setMailTransport(async () => ({ sent: true, id: "x" }));
  try {
    const p = await architect();
    const ip = `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    for (let i = 0; i < 5; i++)
      await createReferralRequest(p, { name: `N${i}`, email: mail() }, ip);
    await assert.rejects(
      () => createReferralRequest(p, { name: "N6", email: mail() }, ip),
      /Trop de demandes/,
    );
  } finally {
    setMailTransport(null);
  }
});
