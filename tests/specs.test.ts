import test from "node:test";
import assert from "node:assert/strict";
import { productSpecs, type RawMetafield } from "../app/domain/specs";

const f = (
  namespace: string,
  key: string,
  name: string | null,
  value: string,
  type = "single_line_text_field",
  refs?: string[],
): RawMetafield => ({
  namespace,
  key,
  type,
  value,
  definition: name ? { name } : null,
  references: refs ? { nodes: refs.map((displayName) => ({ displayName })) } : null,
});

test("caractéristiques groupées, unités après la valeur, champs internes cachés", () => {
  const groups = productSpecs([
    f("global", "title_tag", null, "Titre SEO"),
    f("custom", "search_facts", "Données vérifiées", "{}", "json"),
    f("custom", "designer", "Designer", "Hans J. Wegner"),
    f("custom", "width_cm", "Largeur (cm)", "45.5", "number_decimal"),
    f("custom", "height_cm", "Hauteur totale (cm)", "78", "number_decimal"),
    f("custom", "material", "Matériaux / Finitions", "Chêne huilé"),
    f("shopify", "upholstery-material", "Matériau du revêtement", "[]", "list.metaobject_reference", ["Cuir"]),
    f("shopify", "color-pattern", "Couleur", "[]", "list.metaobject_reference", ["Noir"]),
    f("custom", "stackable", "Empilable", "true", "boolean"),
    f("custom", "product_fact_sheet_url", "Fiche technique", "https://example.com/a.pdf"),
  ]);
  assert.deepEqual(
    groups.map((g) => g.title),
    ["Dimensions", "Matériaux et finitions", "Informations", "Documents"],
  );
  assert.deepEqual(groups[0].specs, [
    { label: "Largeur", value: "45,5 cm" },
    { label: "Hauteur totale", value: "78 cm" },
  ]);
  assert.deepEqual(groups[1].specs.map((s) => s.value), ["Chêne huilé", "Cuir"]);
  assert.deepEqual(groups[2].specs, [
    { label: "Designer", value: "Hans J. Wegner" },
    { label: "Empilable", value: "Oui" },
  ]);
  assert.equal(groups[3].specs[0].url, "https://example.com/a.pdf");
  const all = groups.flatMap((g) => g.specs.map((s) => s.label));
  assert.ok(!all.includes("Couleur"));
  assert.ok(!all.includes("Données vérifiées"));
});

test("origine : la phrase la plus complète est gardée une seule fois", () => {
  const groups = productSpecs([
    f("custom", "origin", "Fabrication / Origine", "Danemark"),
    f("custom", "country_of_origin", "Pays d'origine", "Fabriqué au Danemark / Édité par Carl Hansen & Søn"),
  ]);
  assert.deepEqual(groups, [
    {
      title: "Informations",
      specs: [
        {
          label: "Fabrication / Origine",
          value: "Fabriqué au Danemark / Édité par Carl Hansen & Søn",
        },
      ],
    },
  ]);
});

test("aucun métachamp, ou « Non renseigné » : aucune section", () => {
  assert.deepEqual(productSpecs([]), []);
  assert.deepEqual(
    productSpecs([f("custom", "country_of_origin", "Pays d'origine", "Non renseigné")]),
    [],
  );
});
