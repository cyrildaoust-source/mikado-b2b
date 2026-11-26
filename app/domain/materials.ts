/*
 * Matières génériques du mood board : textures Poly Haven, sous licence CC0
 * (domaine public, aucune attribution exigée). Les identifiants ont été relevés
 * dans l'API publique de Poly Haven le 26/11/2026. Pour un tissu ou une pierre
 * d'éditeur (Dedar, Kvadrat…), l'architecte ajoute sa propre photo d'échantillon :
 * les images des éditeurs ne sont pas reprises sans leur accord.
 */

export const TEXTURE_HOST = "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/";

export type Texture = { id: string; name: string };
export const TEXTURE_GROUPS: { label: string; items: Texture[] }[] = [
  {
    label: "Bois",
    items: [
      { id: "oak_veneer_01", name: "Chêne plaqué" },
      { id: "american_walnut_veneer", name: "Noyer américain" },
      { id: "ash_veneer", name: "Frêne" },
      { id: "cherry_veneer", name: "Merisier" },
      { id: "dark_wood", name: "Bois foncé" },
      { id: "herringbone_parquet", name: "Parquet point de Hongrie" },
      { id: "diagonal_parquet", name: "Parquet en diagonale" },
    ],
  },
  {
    label: "Pierre et carrelage",
    items: [
      { id: "grey_cartago_01", name: "Pierre grise veinée" },
      { id: "grey_cartago_03", name: "Pierre grise claire" },
      { id: "terrazzo_tiles", name: "Terrazzo" },
      { id: "granite_tile_03", name: "Granit" },
      { id: "terracotta_floor_tiles", name: "Terre cuite" },
      { id: "interior_tiles", name: "Carrelage beige" },
    ],
  },
  {
    label: "Tissus et cuirs",
    items: [
      { id: "rough_linen", name: "Lin brut" },
      { id: "wool_boucle", name: "Bouclette de laine" },
      { id: "velour_velvet", name: "Velours" },
      { id: "quatrefoil_jacquard_fabric", name: "Jacquard" },
      { id: "hessian_230", name: "Toile de jute" },
      { id: "brown_leather", name: "Cuir naturel" },
    ],
  },
  {
    label: "Enduits et bétons",
    items: [
      { id: "white_stucco", name: "Stuc blanc" },
      { id: "beige_wall_001", name: "Enduit beige" },
      { id: "grey_plaster_02", name: "Enduit gris" },
      { id: "smooth_concrete_floor", name: "Béton lissé" },
      { id: "brushed_concrete_2", name: "Béton brossé" },
    ],
  },
  {
    label: "Métal",
    items: [{ id: "metal_plate_02", name: "Acier brossé" }],
  },
];

export const textureUrl = (id: string) => `${TEXTURE_HOST}${id}/${id}_diff_1k.jpg`;

/** Source admise pour une texture : le seul format de fichier Poly Haven attendu. */
export const TEXTURE_SOURCE = /^https:\/\/dl\.polyhaven\.org\/file\/ph-assets\/Textures\/jpg\/1k\/[a-z0-9_]+\/[a-z0-9_]+_diff_1k\.jpg$/;
