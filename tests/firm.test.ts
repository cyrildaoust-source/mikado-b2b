import test from "node:test";
import assert from "node:assert/strict";
import { firmMissing, firmSchema, sniffImage } from "../app/services/firm.server";

test("fiche cabinet : TVA normalisée, e-mail vide admis", () => {
  const f = firmSchema.parse({
    name: " Atelier A ",
    address: "Rue X 1, 1180 Uccle",
    vat: "be 0123.456.789",
    phone: "",
    email: "",
    website: "",
  });
  assert.equal(f.name, "Atelier A");
  assert.equal(f.vat, "BE0123456789");
  assert.throws(() =>
    firmSchema.parse({ name: "", address: "", vat: "", email: "pas-un-mail" }),
  );
});

test("fiche cabinet : champs requis pour une proposition", () => {
  assert.deepEqual(firmMissing({ name: "", address: "a", vat: "" }), [
    "le nom du cabinet",
    "le numéro de TVA",
  ]);
  assert.deepEqual(firmMissing({ name: "n", address: "a", vat: "v" }), []);
});

test("logo : le type vient du contenu, pas du nom", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0]);
  const webp = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
  assert.equal(sniffImage(png), "image/png");
  assert.equal(sniffImage(jpg), "image/jpeg");
  assert.equal(sniffImage(webp), "image/webp");
  assert.equal(sniffImage(new TextEncoder().encode("<svg onload=x>")), null);
});
