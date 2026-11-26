// Tests d'intégration sur une base Postgres jetable : un schéma neuf par exécution,
// supprimé à la fin. TEST_DATABASE_URL pointe vers une base de test, jamais la production.
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const base = process.env.TEST_DATABASE_URL;
if (!base) {
  console.error(
    "Définissez TEST_DATABASE_URL (ex. postgresql://postgres:postgres@127.0.0.1:5432/mikado_test).",
  );
  process.exit(1);
}
const schema = `test_${randomBytes(4).toString("hex")}`;
const url = new URL(base);
url.searchParams.set("schema", schema);
const env = {
  ...process.env,
  DATABASE_URL: url.toString(),
  DATABASE_URL_UNPOOLED: url.toString(),
};
const run = (args) =>
  spawnSync(process.execPath, args, { env, stdio: "inherit" }).status;
try {
  for (const args of [
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    [
      "--import",
      "tsx",
      "--test",
      "--test-concurrency=1",
      "tests/integration/persistence.test.ts",
      "tests/integration/pro-access.test.ts",
      "tests/integration/share.test.ts",
    ],
  ]) {
    const status = run(args);
    if (status !== 0) {
      process.exitCode = status || 1;
      break;
    }
  }
} finally {
  const drop = spawnSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "db", "execute", "--stdin", "--url", base],
    { input: `DROP SCHEMA IF EXISTS "${schema}" CASCADE;`, env },
  );
  if (drop.status !== 0) console.error(`Schéma ${schema} à supprimer à la main.`);
}
