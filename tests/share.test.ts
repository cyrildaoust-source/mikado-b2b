import test from "node:test";
import assert from "node:assert/strict";
import { shareExpiry, SHARE_MAX_DAYS } from "../app/services/share.server";
import { safeLogo, sellerLines } from "../app/domain/seller";

const issued = new Date("2026-11-26T10:00:00Z");

test("lien en ligne : fin du jour de validité, un mois au plus", () => {
  assert.equal(
    shareExpiry("2026-12-20", issued, issued).toISOString(),
    "2026-12-20T22:59:59.000Z",
  );
  assert.equal(
    shareExpiry("2027-06-01", issued, issued).getTime(),
    issued.getTime() + SHARE_MAX_DAYS * 86400000,
  );
  assert.throws(() => shareExpiry("2026-11-01", issued, issued), /passée/);
});

test("offre d'un cabinet : jamais les coordonnées de Mikado Deco", () => {
  const firm = {
    name: "Atelier",
    address: "Rue 1",
    email: "",
    website: "",
    vat: "BE1",
    phone: "02 000 00 00",
    kind: "firm" as const,
  };
  assert.deepEqual(sellerLines(firm), { address: "Rue 1", contact: ["02 000 00 00"] });
  assert.deepEqual(sellerLines(undefined).contact, [
    "shop@mikadodeco.be",
    "www.mikadodeco.be",
  ]);
  assert.equal(safeLogo("data:image/png;base64,iVBORw0KGgo="), "data:image/png;base64,iVBORw0KGgo=");
  assert.equal(safeLogo("data:image/svg+xml;base64,PHN2Zz4="), undefined);
  assert.equal(safeLogo("https://evil.test/x.png"), undefined);
});
