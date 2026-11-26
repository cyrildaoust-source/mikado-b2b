import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listZip, readZipEntry, zipImages } from "../app/domain/zip";

test("zip : liste les photos et les décompresse", async () => {
  const dir = mkdtempSync(join(tmpdir(), "zip-"));
  mkdirSync(join(dir, "Hallingdal 65"));
  mkdirSync(join(dir, "__MACOSX"));
  const photo = Buffer.alloc(5000, 7);
  writeFileSync(join(dir, "Hallingdal 65", "1000_0130.jpg"), photo);
  writeFileSync(join(dir, "Hallingdal 65", "lisez-moi.txt"), "x");
  writeFileSync(join(dir, "__MACOSX", "._1000_0130.jpg"), "x");
  execFileSync("python3", ["-c", `import shutil; shutil.make_archive(${JSON.stringify(join(dir, "pack"))}, "zip", ${JSON.stringify(dir)})`]);
  const b = readFileSync(join(dir, "pack.zip"));
  const buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  const images = zipImages(listZip(buf));
  assert.deepEqual(images.map((e) => e.name), ["Hallingdal 65/1000_0130.jpg"]);
  const data = await readZipEntry(buf, images[0]);
  assert.equal(data.length, 5000);
  assert.ok(Buffer.from(data).equals(photo));
});

test("zip : un fichier qui n'est pas une archive est refusé", () => {
  assert.throws(() => listZip(new ArrayBuffer(100)), /archive zip/);
});
