import test from "node:test";
import assert from "node:assert/strict";
import {
  commissionLines,
  commissionOf,
  isReferralCode,
  makeReferralCode,
  referralEnd,
  simulate,
  stageOf,
  totalsOf,
} from "../app/domain/referral";

test("code de lien : 8 caractères sans ambiguïté", () => {
  const code = makeReferralCode((n) => new Uint8Array(n).map((_, i) => i * 37));
  assert.equal(code.length, 8);
  assert.ok(isReferralCode(code));
  assert.ok(!/[01ilo]/.test(code));
  assert.ok(!isReferralCode("abc"));
  assert.ok(!isReferralCode("ABCDEFGH"));
  assert.ok(!isReferralCode("abcdefg1"));
});

test("commission : 2 % de la marchandise, arrondie au centime", () => {
  assert.equal(commissionOf(100000), 2000);
  assert.equal(commissionOf(12345), 247);
  assert.equal(simulate(3, 5000000), 300000);
  assert.equal(simulate(-1, 5000000), 0);
});

test("commission : contresignée à venir, facturée acquise, dans les 12 mois", () => {
  const from = new Date("2026-01-15T10:00:00Z");
  assert.equal(referralEnd(from).toISOString(), "2027-01-15T10:00:00.000Z");
  const sale = (at: string, status: string, merchandise = 100000) => ({
    quoteId: 1,
    signedAt: new Date(at),
    status,
    merchandise,
  });
  const lines = commissionLines(
    [
      sale("2026-02-01T10:00:00Z", "signed"),
      sale("2026-03-01T10:00:00Z", "invoiced", 50000),
      sale("2026-01-10T10:00:00Z", "invoiced"), // avant l'arrivée
      sale("2027-01-16T10:00:00Z", "invoiced"), // après les 12 mois
      sale("2026-04-01T10:00:00Z", "accepted"), // pas contresigné
      sale("2026-05-01T10:00:00Z", "invoiced", 0), // rien de facturé
    ],
    from,
  );
  assert.deepEqual(
    lines.map((l) => [l.state, l.commission]),
    [
      ["earned", 1000],
      ["pending", 2000],
    ],
  );
  assert.deepEqual(totalsOf(lines), { earned: 1000, pending: 2000, volume: 150000 });
  assert.deepEqual(commissionLines([sale("2026-02-01T10:00:00Z", "signed")], null), []);
});

test("étapes du filleul", () => {
  assert.equal(stageOf({ hasAccount: false, ready: false, sales: 0 }), "request");
  assert.equal(stageOf({ hasAccount: true, ready: false, sales: 0 }), "invited");
  assert.equal(stageOf({ hasAccount: true, ready: true, sales: 0 }), "active");
  assert.equal(stageOf({ hasAccount: true, ready: true, sales: 2 }), "selling");
});
