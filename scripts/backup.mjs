// Authenticated encryption; key file stays outside the source tree and backup destination.
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
  existsSync,
} from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const [action, input, output, keyFile] = process.argv.slice(2);
if (!["backup", "restore"].includes(action) || !input || !output || !keyFile)
  throw Error(
    "Usage: node scripts/backup.mjs backup|restore INPUT OUTPUT KEY_FILE (32-byte key)",
  );
if (existsSync(output))
  throw Error("La destination existe déjà : aucun écrasement autorisé.");
const key = readFileSync(keyFile);
if (key.length !== 32)
  throw Error("La clé doit contenir exactement 32 octets.");
const dir = mkdtempSync(join(tmpdir(), "mikado-backup-")),
  snapshot = join(dir, "snapshot.sqlite");
function python(code, args) {
  const r = spawnSync("python3", ["-c", code, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw Error(r.stderr || "Contrôle SQLite impossible");
}
try {
  if (action === "backup") {
    python(
      "import sqlite3,sys; a=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); b=sqlite3.connect(sys.argv[2]); a.backup(b); assert b.execute('pragma integrity_check').fetchone()[0]=='ok'; b.close(); a.close()",
      [resolve(input), snapshot],
    );
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from("MIKADO1"));
    const data = Buffer.concat([
      cipher.update(readFileSync(snapshot)),
      cipher.final(),
    ]);
    writeFileSync(
      output,
      Buffer.concat([Buffer.from("MIKADO1"), iv, cipher.getAuthTag(), data]),
      { flag: "wx", mode: 0o600 },
    );
  } else {
    const bytes = readFileSync(input);
    if (bytes.subarray(0, 7).toString() !== "MIKADO1")
      throw Error("Format incorrect");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      bytes.subarray(7, 19),
    );
    decipher.setAAD(bytes.subarray(0, 7));
    decipher.setAuthTag(bytes.subarray(19, 35));
    const plain = Buffer.concat([
      decipher.update(bytes.subarray(35)),
      decipher.final(),
    ]);
    writeFileSync(snapshot, plain, { mode: 0o600 });
    python(
      "import sqlite3,sys; c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); assert c.execute('pragma integrity_check').fetchone()[0]=='ok'; c.close()",
      [snapshot],
    );
    writeFileSync(output, plain, { flag: "wx", mode: 0o600 });
  }
  console.log(
    action === "backup"
      ? "Sauvegarde chiffrée et vérifiée."
      : "Restauration vérifiée dans un nouveau fichier.",
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
