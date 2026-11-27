import test from "node:test";
import assert from "node:assert/strict";
import db from "../../app/db.server";
import { emptyQuote, lineSchema, setDeliveryFee, type QuoteState } from "../../app/domain/quote";
import { createQuote } from "../../app/services/quotes.server";
import { publishQuote } from "../../app/services/conversion.server";
import { saveFirm } from "../../app/services/firm.server";
import { createShare } from "../../app/services/share.server";
import { architectStatus } from "../../app/services/classes.server";
import { setMailTransport, type Mail } from "../../app/services/mail.server";
import {
  acceptProposal,
  currentDecision,
  invoiceQueue,
  markInvoiced,
  remindOverdue,
  reopenDecision,
  signDecision,
} from "../../app/services/decision.server";

const shop = `decision-${Date.now()}.local`;
const line = (id: string, price: number, extra: object = {}) =>
  lineSchema.parse({ id, name: id, qty: 1, price, discount: 0, vatRate: 21, sourcePrice: price, ...extra });

function state(): QuoteState {
  let s = emptyQuote();
  s.client = "Anne Dupont";
  s.groups = [
    { id: "g", section: "Salon", sectionId: "s", selected: "a", syncQty: true,
      // Remise client de l'architecte sur la ligne a : sans effet sur la facture Mikado.
      items: [line("a", 100000, { discount: 10 }), line("b", 80000)] },
  ];
  s.extras = [{ ...line("opt", 20000), selected: false, parent: "g" }];
  return setDeliveryFee(s, true, "liv", 5);
}

async function setup() {
  const u = await db.user.create({
    data: { email: `d-${Date.now()}-${Math.random()}@test.be`, name: "Archi Test", role: "architect" },
  });
  await saveFirm(u.id, { name: "Atelier", address: "Rue 1", vat: "BE1", phone: "", email: "", website: "" });
  const q = await createQuote(shop, state(), u.id);
  await publishQuote(shop, q.id, 1, null);
  await db.revision.update({
    where: { quoteId_version: { quoteId: q.id, version: 1 } },
    data: { pdfGeneratedAt: new Date(), pdf: Buffer.from("pdf") },
  });
  const { token } = await createShare(shop, q.id, 1, u.id);
  return { u, q, token };
}

const form = (choices: object, extra: object = {}) => ({
  firstName: "Anne",
  lastName: "Dupont",
  agree: "on",
  remark: "",
  choices: JSON.stringify(choices),
  ...extra,
});

test("acceptation : montants refaits côté serveur, première décision seulement", async () => {
  const { u, q, token } = await setup();
  await assert.rejects(() => acceptProposal(token, form({}, { agree: "" })), /engagement/);
  const d = await acceptProposal(token, form({ groups: { g: "b" }, options: { opt: true, liv: false } }));
  // 800 + 200 option + 5 % de 1 000 = 1 050 HTVA ; la livraison ne se décoche pas.
  assert.equal(d.net, 105000);
  assert.equal(d.gross, 127050);
  assert.equal((await db.quote.findUniqueOrThrow({ where: { id: q.id } })).status, "accepted");
  await assert.rejects(() => acceptProposal(token, form({})), /déjà reçu une réponse/);

  // Mikado Deco ne signe pas à la place de l'architecte.
  await assert.rejects(
    () => signDecision(shop, q.id, { id: 999999, role: "admin", name: "Mikado" }, { name: "Mikado", confirm: "on" }),
    /Seul l'architecte/,
  );
  const me = { id: u.id, role: "architect", name: "Archi Test" };
  await signDecision(shop, q.id, me, { name: "Archi Test", confirm: "on" });
  const st = await architectStatus(shop, u.id);
  const discount = st?.current?.discount ?? 0;
  const row = (await invoiceQueue(shop)).find((r) => r.quoteId === q.id)!;
  assert.equal(row.status, "signed");
  // Prix public de la marchandise retenue (800 + 200) moins la classe, livraison 5 % du prix pro.
  const pro = Math.round((100000 * (100 - discount)) / 100);
  assert.equal(row.billing?.merchandisePublic, 100000);
  assert.equal(row.billing?.merchandisePro, pro);
  assert.equal(row.billing?.net, pro + Math.round(pro * 0.05));
  await assert.rejects(() => reopenDecision(shop, q.id, me), /contresignée/);

  await assert.rejects(() => markInvoiced(shop, row.id, null, ""), /échéance/);
  await markInvoiced(shop, row.id, null, "2027-01-15");
  assert.equal((await currentDecision(q.id))?.status, "invoiced");
  await assert.rejects(() => markInvoiced(shop, row.id, null, "2027-01-15"), /déjà été traitée/);
});

test("révision : l'architecte rouvre, le lien est retiré, rappel unique après 48 h", async () => {
  const { u, q, token } = await setup();
  const me = { id: u.id, role: "architect", name: "Archi Test" };
  await acceptProposal(token, form({}));
  await reopenDecision(shop, q.id, me);
  assert.equal((await db.quote.findUniqueOrThrow({ where: { id: q.id } })).status, "draft");
  assert.equal(await currentDecision(q.id), null);
  await assert.rejects(() => acceptProposal(token, form({})), /plus valable/);

  const again = await createShare(shop, q.id, 1, u.id);
  const d = await acceptProposal(again.token, form({}));
  await db.quoteDecision.update({ where: { id: d.id }, data: { deadline: new Date(Date.now() - 1000) } });
  assert.equal((await currentDecision(q.id))?.late, true);

  // E-mails simulés : le premier envoi à Mikado Deco échoue.
  const outbox: (Mail & { to: string[] })[] = [];
  let failMikado = true;
  setMailTransport(async (mail) => {
    if (failMikado && mail.subject.startsWith("[Mikado Pro]"))
      return { sent: false, reason: "http-500" };
    outbox.push(mail);
    return { sent: true, id: `sim-${outbox.length}` };
  });
  try {
    await remindOverdue();
    const mine = () => outbox.filter((m) => m.idempotencyKey?.startsWith(`decision-${d.id}-`));
    assert.deepEqual(mine().map((m) => m.idempotencyKey), [`decision-${d.id}-architect`]);
    let rows = await db.decisionReminder.findMany({ where: { decisionId: d.id }, orderBy: { kind: "asc" } });
    assert.match(rows.find((r) => r.kind === "architect")?.providerId ?? "", /^sim-/);
    assert.equal(rows.find((r) => r.kind === "mikado")?.sentAt, null);
    assert.equal(rows.find((r) => r.kind === "mikado")?.lastError, "http-500");
    assert.equal((await db.quoteDecision.findUniqueOrThrow({ where: { id: d.id } })).remindedAt, null);

    // Nouveau passage : seul le rappel en échec repart.
    failMikado = false;
    await remindOverdue();
    assert.deepEqual(mine().map((m) => m.idempotencyKey), [
      `decision-${d.id}-architect`,
      `decision-${d.id}-mikado`,
    ]);
    rows = await db.decisionReminder.findMany({ where: { decisionId: d.id } });
    assert.ok(rows.every((r) => r.sentAt));
    assert.notEqual((await db.quoteDecision.findUniqueOrThrow({ where: { id: d.id } })).remindedAt, null);

    // Troisième passage : plus rien.
    await remindOverdue();
    assert.equal(mine().length, 2);
  } finally {
    setMailTransport(null);
  }
  // Rien n'est facturé : la ligne reste en attente de contresignature,
  // et l'architecte peut encore signer après 48 h (rappel seulement).
  assert.equal((await invoiceQueue(shop)).find((r) => r.id === d.id)?.status, "accepted");
  await signDecision(shop, q.id, me, { name: "Archi Test", confirm: "on" });
  assert.equal((await invoiceQueue(shop)).find((r) => r.id === d.id)?.status, "signed");
});
