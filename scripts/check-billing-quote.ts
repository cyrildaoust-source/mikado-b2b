import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

Object.assign(process.env, parseEnv(readFileSync(".env", "utf8")), {
  ODOO_AUTOMATION_ENABLED: "true",
  ODOO_LEGACY_GUARD_CONFIRMED: "true",
});
const quoteId = Number(process.argv[2]);
if (!Number.isSafeInteger(quoteId) || quoteId <= 0)
  throw Error("Indiquez un identifiant de devis valide.");
const { preflightBilling } = await import(
  "../app/services/billing-v2.server"
);
const milestones = await preflightBilling(process.env.ODOO_SHOP!, quoteId);
console.log(
  JSON.stringify({
    status: "ok",
    quoteId,
    milestones: milestones.map((milestone) => ({
      kind: milestone.kind,
      percent: milestone.percent,
      net: milestone.net,
      tax: milestone.tax,
      gross: milestone.amount,
    })),
  }),
);
