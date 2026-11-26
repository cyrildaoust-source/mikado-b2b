import test from "node:test";
import assert from "node:assert/strict";
import { parseModels3d, productModels3d } from "../app/domain/models3d";
import type { RawMetafield } from "../app/domain/specs";

const field = (value: string): RawMetafield => ({
  namespace: "custom",
  key: "models_3d",
  type: "json",
  value,
  definition: { name: "Modèles 3D" },
});
const libraries = {
  HAY: { url: "https://hay.example/3d", access: "public" as const, formats: ["DWG"] },
};

test("fichiers du métachamp : https seulement, formats en capitales, doublons retirés", () => {
  const m = parseModels3d(
    JSON.stringify({
      files: [
        { format: "dwg", url: "https://cdn.example/a.dwg" },
        { format: "DWG", url: "https://cdn.example/a.dwg" },
        { format: "SKP", url: "http://cdn.example/a.skp" },
        { format: "<script>", url: "https://cdn.example/b.obj" },
        { format: "3DS", url: "javascript:alert(1)" },
      ],
      page: "https://brand.example/produit",
    }),
  );
  assert.deepEqual(m, {
    files: [{ format: "DWG", url: "https://cdn.example/a.dwg" }],
    page: "https://brand.example/produit",
  });
});

test("une liste seule est admise, une valeur cassée est ignorée", () => {
  assert.equal(parseModels3d('[{"format":"OBJ","url":"https://x.example/m.obj"}]').files.length, 1);
  assert.deepEqual(parseModels3d("{pas du json"), { files: [] });
  assert.deepEqual(parseModels3d('"texte"'), { files: [] });
  assert.deepEqual(parseModels3d(null), { files: [] });
});

test("la fiche passe avant la bibliothèque de la marque", () => {
  const own = productModels3d(
    [field('{"files":[{"format":"DWG","url":"https://x.example/m.dwg"}]}')],
    "HAY",
    libraries,
  );
  assert.equal(own?.files.length, 1);
  assert.equal(own?.library, undefined);
  const lib = productModels3d([], "HAY", libraries);
  assert.equal(lib?.library?.url, "https://hay.example/3d");
  assert.equal(lib?.library?.vendor, "HAY");
  assert.equal(productModels3d([], "Marque sans source", libraries), null);
});
