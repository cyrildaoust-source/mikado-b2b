import {
  clientView,
  optionsOf,
  repriceExtras,
  type QuoteState,
} from "./quote";

/**
 * Choix du client sur une proposition en ligne : une alternative par produit,
 * et les options cochées ou non. Les prestations et la livraison ne se
 * décochent pas : l'architecte les a retenues.
 */
export type Choices = {
  groups: Record<string, string>;
  options: Record<string, boolean>;
};

/** Options que le client peut cocher : celles rattachées à un produit. */
export const choosableOptions = (s: QuoteState) =>
  s.extras.filter(
    (e) => !e.deliveryFee && s.groups.some((g) => g.id === e.parent),
  );

export function initialChoices(s: QuoteState): Choices {
  return {
    groups: Object.fromEntries(s.groups.map((g) => [g.id, g.selected])),
    options: Object.fromEntries(
      choosableOptions(s).map((e) => [e.id, e.selected]),
    ),
  };
}

/**
 * Proposition telle que le client l'a composée, recalculée comme le devis
 * (livraison en % de la marchandise retenue). Un identifiant inconnu est
 * ignoré : le serveur refera ce calcul sur la révision figée, jamais sur un
 * total envoyé par le navigateur.
 */
export function applyChoices(raw: QuoteState, choices: Partial<Choices>): QuoteState {
  const s = clientView(raw);
  const allowed = new Set(choosableOptions(s).map((e) => e.id));
  return repriceExtras({
    ...s,
    groups: s.groups.map((g) => {
      const pick = choices.groups?.[g.id];
      return pick && g.items.some((i) => i.id === pick)
        ? { ...g, selected: pick }
        : g;
    }),
    extras: s.extras.map((e) =>
      allowed.has(e.id) && typeof choices.options?.[e.id] === "boolean"
        ? { ...e, selected: choices.options[e.id] }
        : e,
    ),
  });
}

/** Lignes d'un produit pour l'affichage : alternatives puis options. */
export function productBlock(s: QuoteState, groupId: string) {
  const g = s.groups.find((x) => x.id === groupId)!;
  return { group: g, options: optionsOf(s, groupId).filter((e) => !e.deliveryFee) };
}
