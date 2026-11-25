// Crée un accès à l'outil pro et affiche son lien d'invitation (usage unique, 7 jours).
// Usage : npm run user:invite -- --email cyril@exemple.be --name "Cyril" --role admin
import { parseArgs } from "node:util";
import db from "../app/db.server";
import { createInvite, normalizeEmail } from "../app/services/auth.server";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    role: { type: "string", default: "architect" },
  },
});
if (!values.email || !values.name || !["admin", "architect"].includes(values.role!)) {
  console.error('Usage : --email <e-mail> --name "<nom>" [--role admin|architect]');
  process.exit(1);
}
const email = normalizeEmail(values.email);
const user =
  (await db.user.findUnique({ where: { email } })) ??
  (await db.user.create({ data: { email, name: values.name, role: values.role! } }));
const token = await createInvite(user.id);
const base = (process.env.SHOPIFY_APP_URL || "http://localhost:3000").replace(/\/$/, "");
console.log(`Lien pour ${user.name} (${user.email}) : ${base}/invitation/${token}`);
await db.$disconnect();
