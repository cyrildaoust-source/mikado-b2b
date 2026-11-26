/**
 * Tableau de bord de l'outil pro : classement des devis et délais.
 *
 * Fonctions pures, sans base ni Shopify, pour rester testables. Le service
 * (services/dashboard.server.ts) lit les devis et les délais puis appelle ces
 * fonctions.
 */

/** Étape d'un devis vue de l'architecte. */
export type Stage =
  | "draft" // en préparation : brouillon, modifications, PDF à préparer
  | "ready" // PDF prêt, pas encore envoyé
  | "sent" // envoyé, en attente de la réponse du client
  | "ordered" // accepté : commande créée par Mikado Deco
  | "check"; // commande à vérifier par Mikado Deco

export type StageInput = {
  status: string;
  version: number;
  conversion?: { status: string; orderStatus?: string | null } | null;
  revisions?: {
    version: number;
    publishedNumber: number | null;
    sentAt: unknown;
    pdfGeneratedAt?: unknown;
  }[];
};

/** Même lecture que commercialStatus (domain/quote.ts), en cinq étapes. */
export function stage(q: StageInput): Stage | null {
  if (q.status === "deleted" || q.status === "archived") return null;
  if (
    q.conversion &&
    (["creating", "uncertain"].includes(q.conversion.status) ||
      ["creating", "uncertain"].includes(q.conversion.orderStatus || ""))
  )
    return "check";
  if (q.status === "converted") return "ordered";
  // Même règle que la liste des devis : la version en cours a son PDF. Une
  // modification après l'envoi ramène le devis en préparation (« Modifications
  // en cours ») ; la révision envoyée reste signalée par editingAfterRelease.
  const ready = q.revisions?.find(
    (r) => r.publishedNumber && r.pdfGeneratedAt && r.version === q.version,
  );
  if (!ready) return "draft";
  return ready.sentAt ? "sent" : "ready";
}

/** Une nouvelle version est en cours après une révision déjà envoyée au client. */
export function editingAfterRelease(q: StageInput) {
  const last = q.revisions?.find((r) => r.publishedNumber && r.pdfGeneratedAt);
  return !!last && last.version !== q.version && !!last.sentAt;
}

/* ------------------------------------------------------------------ */
/* Délais                                                              */
/* ------------------------------------------------------------------ */

/**
 * Délai `custom.lead_time` posé par l'importateur : « 7-10 jours ouvrés »,
 * « 6-10 semaines », « 3 semaines » ou « sur demande ». C'est le délai annoncé
 * par la marque jusqu'à la boutique, quand Mikado Deco n'a pas l'article.
 */
export type LeadTime =
  | { kind: "days"; min: number; max: number; text: string }
  | { kind: "onRequest"; text: string };

const FORMAT =
  /^([1-9][0-9]*)(?:\s*[-–]\s*([1-9][0-9]*))?\s+(jours?\s+ouvrés?|jours?|semaines?)$/i;

/** Lit un délai. En jours ouvrés (cinq par semaine). Illisible : null. */
export function parseLeadTime(raw: string | null | undefined): LeadTime | null {
  const text = (raw || "").trim().replace(/\s+/g, " ");
  if (!text) return null;
  if (/^sur demande$/i.test(text))
    return { kind: "onRequest", text: "sur demande" };
  const m = FORMAT.exec(text);
  if (!m) return null;
  const a = Number(m[1]),
    b = Number(m[2] || m[1]);
  if (a > b) return null;
  const unit = m[3].toLowerCase();
  const factor = unit.startsWith("semaine")
    ? 5
    : unit.includes("ouvr")
      ? 1
      : 5 / 7;
  return {
    kind: "days",
    min: Math.round(a * factor),
    max: Math.round(b * factor),
    text,
  };
}

/** Le plus long des délais : « sur demande » l'emporte sur tout délai chiffré. */
export function longest(times: (LeadTime | null)[]): LeadTime | null {
  let best: LeadTime | null = null;
  for (const t of times) {
    if (!t) continue;
    if (t.kind === "onRequest") return t;
    if (
      !best ||
      (best.kind === "days" &&
        (t.max > best.max || (t.max === best.max && t.min > best.min)))
    )
      best = t;
  }
  return best;
}

/** Ajoute des jours ouvrés (lundi à vendredi) à une date. */
export function addWorkingDays(from: Date, days: number) {
  const d = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) left--;
  }
  return d;
}

/** Fenêtre d'arrivée chez Mikado Deco à partir de la date de commande. */
export function arrivalWindow(orderedAt: Date, t: LeadTime | null) {
  if (!t || t.kind !== "days") return null;
  return {
    from: addWorkingDays(orderedAt, t.min),
    to: addWorkingDays(orderedAt, t.max),
  };
}

/** Délai d'un devis : le plus long de ses produits retenus, et ce qui manque. */
export type QuoteLeadTime = {
  /** Le délai le plus long connu, ou null. */
  longest: LeadTime | null;
  /** Produits du catalogue sans délai lisible. */
  missing: number;
  /** Produits du catalogue retenus. */
  products: number;
};

export function quoteLeadTime(
  variantIds: string[],
  byVariant: Map<string, string | null>,
): QuoteLeadTime {
  const ids = [...new Set(variantIds)];
  const times = ids.map((id) => parseLeadTime(byVariant.get(id)));
  return {
    longest: longest(times),
    missing: times.filter((t) => !t).length,
    products: ids.length,
  };
}

/* ------------------------------------------------------------------ */
/* Relances et validité                                                */
/* ------------------------------------------------------------------ */

/** Après ce nombre de jours sans réponse, le tableau de bord propose une relance. */
export const FOLLOW_UP_DAYS = 10;

const DAY = 86400000;

/** Jours entiers écoulés entre deux dates (au jour près, heure de Bruxelles ignorée). */
export function daysBetween(a: Date, b: Date) {
  const day = (d: Date) =>
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((day(b) - day(a)) / DAY);
}

/** Jours restants avant la fin de validité (négatif : dépassée). */
export function validityLeft(validity: string, today: Date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validity)) return null;
  return daysBetween(today, new Date(`${validity}T00:00:00Z`));
}

/** Prénom pour « Bonjour … » : le premier mot du nom du compte. */
export function firstName(name: string | null | undefined) {
  const first = (name || "").trim().split(/\s+/)[0] || "";
  return first.includes("@") ? "" : first;
}

/** Statut de livraison Shopify d'une commande, en mots simples. */
export function deliveryLabel(
  fulfillment: string | null | undefined,
  cancelled = false,
) {
  if (cancelled) return "Commande annulée";
  switch (fulfillment) {
    case "FULFILLED":
      return "Livrée";
    case "PARTIALLY_FULFILLED":
      return "Livrée en partie";
    case "IN_PROGRESS":
    case "PENDING_FULFILLMENT":
    case "OPEN":
    case "SCHEDULED":
    case "ON_HOLD":
    case "UNFULFILLED":
      return "En commande";
    default:
      return null;
  }
}
