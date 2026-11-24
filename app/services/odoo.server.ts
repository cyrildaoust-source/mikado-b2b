import { spawn } from "node:child_process";
import { resolve } from "node:path";
export type OdooRpc = <T>(
  model: string,
  method: string,
  args: unknown[],
  kwargs?: Record<string, unknown>,
) => Promise<T>;
export function odooConfigured() {
  return [
    "ODOO_URL",
    "ODOO_DB",
    "ODOO_LOGIN",
    "ODOO_API_KEY",
    "ODOO_SHOP",
    "ODOO_COMPANY_ID",
    "ODOO_JOURNAL_ID",
    "ODOO_ACCOUNT_ID",
    "ODOO_TAX_ID",
  ].every((k) => !!process.env[k]);
}
export const odooRpc: OdooRpc = (model, method, args, kwargs = {}) =>
  new Promise((resolveResult, reject) => {
    const child = spawn(
      process.env.PYTHON_EXECUTABLE || "python3",
      [resolve("connectors/odoo/rpc.py")],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        Error(
          "Odoo ne répond pas. Vérification nécessaire avant une nouvelle création.",
        ),
      );
    }, 65000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.length > 1000000) child.kill("SIGKILL");
    });
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.on("error", () => {
      clearTimeout(timer);
      reject(Error("Le connecteur Python Odoo ne peut pas démarrer."));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        const data = JSON.parse(output);
        if (code || data.error) throw Error();
        resolveResult(data.result);
      } catch {
        reject(
          Error(
            "Connexion Odoo impossible ou requête refusée. Vérifiez les accès et les paramètres.",
          ),
        );
      }
    });
    child.stdin.end(JSON.stringify({ model, method, args, kwargs }));
  });
export type Invoice = {
  id: number;
  name: string;
  state: string;
  payment_state: string;
  amount_total: number;
  amount_untaxed: number;
  amount_tax: number;
  amount_residual: number;
  currency_id: [number, string];
  partner_id: [number, string];
  company_id: [number, string];
  ref: string;
  payment_reference: string | false;
  invoice_origin: string;
  invoice_date: string;
  invoice_line_ids: number[];
  reversed_entry_id: false | [number, string];
};
export const invoiceFields = [
  "id",
  "name",
  "state",
  "payment_state",
  "amount_total",
  "amount_untaxed",
  "amount_tax",
  "amount_residual",
  "currency_id",
  "partner_id",
  "company_id",
  "ref",
  "payment_reference",
  "invoice_origin",
  "invoice_date",
  "invoice_line_ids",
  "reversed_entry_id",
];
export function odooId(key: string) {
  const id = Number(process.env[key]);
  if (!Number.isSafeInteger(id) || id <= 0)
    throw Error(`Configuration manquante : ${key}`);
  return id;
}

export function odooPublicUrl() {
  try {
    const u = new URL(process.env.ODOO_URL || "");
    return u.protocol === "https:" && !u.username && !u.password
      ? u.origin
      : null;
  } catch {
    return null;
  }
}
