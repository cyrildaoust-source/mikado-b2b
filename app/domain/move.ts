import type { QuoteState } from "./quote";

type Group = QuoteState["groups"][number];

/** Où l'on dépose un produit glissé dans l'éditeur de devis. */
export type DropTarget =
  | { kind: "section"; sectionId: string; title: string }
  | { kind: "group"; groupId: string };

/** Ce que l'on glisse : un groupe entier (produit et ses alternatives)
 * ou une seule ligne (une alternative). */
export type DragSource =
  { kind: "group"; groupId: string } | { kind: "line"; lineId: string };

const MAX_ITEMS = 20;

/** Déplace un produit par glisser-déposer. Rend l'état inchangé (même objet)
 * quand le dépôt n'a pas de sens : sur lui-même, groupe plein, cible absente. */
export function dropOnQuote(
  s: QuoteState,
  source: DragSource,
  target: DropTarget,
): QuoteState {
  const from =
    source.kind === "group"
      ? s.groups.find((g) => g.id === source.groupId)
      : s.groups.find((g) => g.items.some((i) => i.id === source.lineId));
  if (!from) return s;

  // Un groupe entier vers une pièce : il change de pièce, en fin de pièce.
  if (source.kind === "group" && target.kind === "section") {
    if (from.sectionId === target.sectionId) return s;
    const moved: Group = {
      ...from,
      sectionId: target.sectionId,
      section: target.title,
    };
    return {
      ...s,
      groups: insertInSection(
        s.groups.filter((g) => g !== from),
        moved,
      ),
    };
  }

  // Un groupe entier sur un autre groupe : tous ses produits deviennent
  // des alternatives de ce groupe.
  if (source.kind === "group" && target.kind === "group") {
    const to = s.groups.find((g) => g.id === target.groupId);
    if (!to || to === from) return s;
    if (to.items.length + from.items.length > MAX_ITEMS) return s;
    const items = from.items.map((i) => ({
      ...i,
      qty: to.syncQty ? to.items[0].qty : i.qty,
    }));
    return {
      ...s,
      groups: s.groups
        .filter((g) => g !== from)
        .map((g) => (g === to ? { ...g, items: [...g.items, ...items] } : g)),
      extras: reparent(s, from.id, to.id),
    };
  }

  // Une seule ligne (alternative) : on la retire de son groupe.
  const lineId = (source as { lineId: string }).lineId;
  const line = from.items.find((i) => i.id === lineId)!;
  const rest = from.items.filter((i) => i.id !== lineId);
  const left: Group | null = rest.length
    ? {
        ...from,
        items: rest,
        selected: from.selected === lineId ? rest[0].id : from.selected,
      }
    : null;

  if (target.kind === "group") {
    const to = s.groups.find((g) => g.id === target.groupId);
    if (!to || to === from || to.items.length >= MAX_ITEMS) return s;
    const added = { ...line, qty: to.syncQty ? to.items[0].qty : line.qty };
    return {
      ...s,
      groups: s.groups.flatMap((g) =>
        g === from
          ? left
            ? [left]
            : []
          : g === to
            ? [{ ...g, items: [...g.items, added] }]
            : [g],
      ),
      extras: left ? s.extras : reparent(s, from.id, to.id),
    };
  }

  // Une ligne vers une pièce : elle devient un produit à part entière.
  if (!left && from.sectionId === target.sectionId) return s;
  const created: Group = {
    id: newId(),
    sectionId: target.sectionId,
    section: target.title,
    selected: line.id,
    syncQty: true,
    items: [line],
  };
  const groups = s.groups.flatMap((g) =>
    g === from ? (left ? [left] : []) : [g],
  );
  return {
    ...s,
    groups: insertInSection(groups, created),
    extras: left ? s.extras : reparent(s, from.id, created.id),
  };
}

/** Les options suivent leur produit quand son groupe disparaît. */
function reparent(s: QuoteState, from: string, to: string) {
  return s.extras.map((e) => (e.parent === from ? { ...e, parent: to } : e));
}

function insertInSection(groups: Group[], group: Group) {
  const last = groups.reduce(
    (at, g, i) => (g.sectionId === group.sectionId ? i : at),
    -1,
  );
  const out = [...groups];
  if (last >= 0) out.splice(last + 1, 0, group);
  else out.push(group);
  return out;
}

function newId() {
  return (
    globalThis.crypto?.randomUUID?.() ?? `g-${Date.now()}-${Math.random()}`
  );
}
