import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const folder = mkdtempSync(join(tmpdir(), "mikado-tests-")),
  db = join(folder, "test.sqlite");
writeFileSync(db, "");
const env = { ...process.env, DATABASE_URL: `file:${db}` };
try {
  for (const args of [
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    ["--import", "tsx", "--test", "tests/integration/persistence.test.ts", "tests/integration/pro-access.test.ts"],
  ]) {
    const r = spawnSync(process.execPath, args, { env, stdio: "inherit" });
    if (r.status !== 0) {
      process.exitCode = r.status || 1;
      break;
    }
  }
} finally {
  rmSync(folder, { recursive: true, force: true });
}
