import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const env = { ...process.env, ...parseEnv(readFileSync(".env", "utf8")) };
const call = (model, method, args, kwargs = {}) => {
  const result = spawnSync(
    env.PYTHON_EXECUTABLE || "python3",
    ["connectors/odoo/rpc.py"],
    {
      env,
      input: JSON.stringify({ model, method, args, kwargs }),
      encoding: "utf8",
      timeout: 70000,
    },
  );
  try {
    const payload = JSON.parse(result.stdout || "{}");
    if (result.status !== 0 || payload.error) throw Error();
    return payload.result;
  } catch {
    throw Error("Connexion Odoo impossible ou configuration refusée.");
  }
};

const companyId = Number(env.ODOO_COMPANY_ID),
  journalId = Number(env.ODOO_JOURNAL_ID),
  accountId = Number(env.ODOO_ACCOUNT_ID),
  taxId = Number(env.ODOO_TAX_ID),
  context = { allowed_company_ids: [companyId] };
const [company] = call("res.company", "read", [[companyId]], {
    fields: ["name", "currency_id", "vat"],
    context,
  }),
  [journal] = call("account.journal", "read", [[journalId]], {
    fields: ["name", "code", "type", "company_id"],
    context,
  }),
  [account] = call("account.account", "read", [[accountId]], {
    fields: ["name", "code"],
    context,
  }),
  [tax] = call("account.tax", "read", [[taxId]], {
    fields: [
      "name",
      "amount",
      "amount_type",
      "price_include",
      "type_tax_use",
      "company_id",
      "active",
    ],
    context,
  });
if (
  !company ||
  company.currency_id?.[1] !== "EUR" ||
  journal?.code !== "INV" ||
  journal?.type !== "sale" ||
  journal?.company_id?.[0] !== companyId ||
  account?.code !== "700000" ||
  tax?.amount !== 21 ||
  tax?.amount_type !== "percent" ||
  tax?.price_include ||
  tax?.type_tax_use !== "sale" ||
  tax?.company_id?.[0] !== companyId ||
  !tax?.active
)
  throw Error("Les référentiels Odoo ne correspondent pas au circuit attendu.");

console.log(
  JSON.stringify({
    status: "ok",
    company: { id: companyId, name: company.name, currency: "EUR" },
    journal: { id: journalId, code: journal.code },
    account: { id: accountId, code: account.code },
    tax: { id: taxId, rate: tax.amount, priceIncluded: tax.price_include },
  }),
);
