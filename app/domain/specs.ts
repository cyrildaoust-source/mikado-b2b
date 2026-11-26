// Caractéristiques d'une fiche : les métachamps Shopify posés par l'importateur
// (custom.*), et les attributs de la taxonomie Shopify (shopify.*) déjà traduits.

export type RawMetafield = {
  namespace: string;
  key: string;
  type: string;
  value: string;
  definition: { name: string } | null;
  references?: { nodes: { displayName?: string }[] } | null;
};

export type Spec = { label: string; value: string; url?: string };
export type SpecGroup = { title: string; specs: Spec[] };

const GROUPS: { title: string; keys: string[] }[] = [
  {
    title: "Dimensions",
    keys: [
      "custom.dimensions",
      "custom.width_cm",
      "custom.depth_cm",
      "custom.height_cm",
      "custom.seat_height_cm",
      "custom.diameter_cm",
      "custom.additional_dimensions",
      "custom.capacity_l",
      "custom.weight",
      "custom.weight_kg",
      "custom.weight_g",
    ],
  },
  {
    title: "Matériaux et finitions",
    keys: [
      "custom.material",
      "mikado.materials",
      "custom.materiaux",
      "custom.construction_materials",
      "custom.production_process",
      "shopify.material",
      "shopify.furniture-fixture-material",
      "shopify.upholstery-material",
      "shopify.fabric",
      "shopify.finish",
      "shopify.wood-finish",
      "shopify.lumber-wood-type",
      "custom.martindale",
      "custom.resistance_uv",
      "custom.deperlant",
      "custom.anti_taches",
      "custom.grand_teint",
    ],
  },
  {
    title: "Éclairage",
    keys: [
      "custom.lighting_type",
      "custom.light_source_type",
      "custom.led_type",
      "custom.power_w",
      "custom.voltage_v",
      "custom.infos_electriques",
      "custom.color_temperature_k",
      "custom.dimming",
      "custom.cable_details",
      "custom.canopy_details",
      "custom.ip_rating",
      "custom.safety_class",
      "custom.energy_label",
      "custom.light_source_replaceable",
      "custom.rechargeable",
      "custom.battery_runtime",
      "custom.charging_time",
      "shopify.lighting-features",
    ],
  },
  {
    title: "Informations",
    keys: [
      "custom.designer",
      "mikado.designer",
      "custom.collection_name",
      "custom.year",
      "custom.year_designed",
      "custom.manufacturer",
      "custom.origin",
      "custom.usage",
      "shopify.style",
      "custom.product_features",
      "shopify.height-adjustment",
      "custom.has_armrests",
      "custom.stackable",
      "custom.foldable",
      "custom.certifications",
      "custom.sustainability",
      "custom.tests_and_standards",
      "custom.warranty",
      "custom.lead_time",
      "custom.nombre_colis",
      "custom.dimensions_colis",
      "custom.poids_colis",
      "custom.entretien",
      "custom.care_instructions",
      "custom.spare_parts",
    ],
  },
  {
    title: "Documents",
    keys: [
      "custom.product_fact_sheet_url",
      "custom.instructions_url",
      "custom.care_url",
    ],
  },
];

/** Champs internes ou redondants : jamais montrés. */
const HIDDEN = new Set([
  "custom.search_facts",
  // Modèles 3D : bloc à part sur la fiche (domain/models3d.ts).
  "custom.models_3d",
  "shopify.color-pattern",
  "mikado.legacy_sales_qty_total",
  "mikado.cost_family",
  "mikado.media_roles",
  "mikado.split_media",
  "mikado.split_media_chain",
  "mikado.lead_time",
  "mikado.purchase_mode",
  "mikado.hover_image",
]);

const SHOWN_NAMESPACES = new Set(["custom", "shopify", "mikado"]);

const number = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n)
    ? n.toLocaleString("fr-BE", { maximumFractionDigits: 2 })
    : v;
};

function format(m: RawMetafield): Spec | null {
  const name = m.definition?.name?.trim();
  if (!name) return null;
  const raw = m.value?.trim();
  if (!raw || /^(non renseigné|inconnu|n\/a|-|—)$/i.test(raw)) return null;
  if (m.type.endsWith("metaobject_reference")) {
    const names = (m.references?.nodes || [])
      .map((n) => n.displayName?.trim())
      .filter(Boolean);
    return names.length ? { label: name, value: names.join(", ") } : null;
  }
  if (m.type === "boolean")
    return { label: name, value: raw === "true" ? "Oui" : "Non" };
  if (m.type === "json" || m.type.includes("reference")) return null;
  if (m.type.startsWith("number")) {
    // « Largeur (cm) » : l'unité passe après la valeur.
    const unit = /^(.*?)\s*\(([^)]{1,6})\)$/.exec(name);
    return unit
      ? { label: unit[1], value: `${number(raw)} ${unit[2]}` }
      : { label: name, value: number(raw) };
  }
  if (/^https?:\/\//i.test(raw) && !/\s/.test(raw))
    return { label: name, value: "Ouvrir", url: raw };
  if (m.type.startsWith("list.")) {
    try {
      const list = JSON.parse(raw);
      if (Array.isArray(list))
        return { label: name, value: list.map(String).join(", ") };
    } catch {
      /* valeur brute ci-dessous */
    }
  }
  return { label: name, value: raw };
}

export function productSpecs(fields: RawMetafield[]): SpecGroup[] {
  const byKey = new Map<string, Spec>();
  for (const m of fields) {
    const key = `${m.namespace}.${m.key}`;
    if (!SHOWN_NAMESPACES.has(m.namespace) || HIDDEN.has(key)) continue;
    const spec = format(m);
    if (spec) byKey.set(key, spec);
  }
  // Pays d'origine et fabrication disent souvent la même chose : on garde la phrase la plus complète.
  const origin = byKey.get("custom.origin"),
    country = byKey.get("custom.country_of_origin");
  if (country) {
    if (!origin || country.value.length > origin.value.length)
      byKey.set("custom.origin", { ...country, label: "Fabrication / Origine" });
    byKey.delete("custom.country_of_origin");
  }
  // Doublons mikado.* quand l'importateur a déjà posé custom.*.
  if (byKey.has("custom.material")) byKey.delete("mikado.materials");
  if (byKey.has("custom.designer")) byKey.delete("mikado.designer");
  if (byKey.has("custom.year")) byKey.delete("custom.year_designed");

  const groups: SpecGroup[] = [];
  const used = new Set<string>();
  const take = (g: { title: string; keys: string[] }) => {
    const specs = g.keys
      .filter((k) => byKey.has(k))
      .map((k) => (used.add(k), byKey.get(k)!));
    if (specs.length) groups.push({ title: g.title, specs });
  };
  GROUPS.slice(0, -1).forEach(take);
  const documents = GROUPS[GROUPS.length - 1];
  const rest = [...byKey]
    .filter(([k]) => !used.has(k) && !documents.keys.includes(k))
    .map(([, s]) => s);
  if (rest.length) groups.push({ title: "Autres caractéristiques", specs: rest });
  take(documents);
  // Une même valeur sous deux libellés identiques ne s'affiche qu'une fois.
  for (const g of groups) {
    const seen = new Set<string>();
    g.specs = g.specs.filter((s) => {
      const id = `${s.label}|${s.value}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }
  return groups;
}
