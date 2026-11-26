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

/**
 * Un devis envoyé est à relancer à partir de FOLLOW_UP_DAYS jours entiers
 * depuis l'envoi de sa révision en cours. Le tableau de bord et le filtre
 * « À relancer » de la liste suivent cette seule règle.
 */
export function needsFollowUp(
  st: Stage | null,
  sentAt: Date | null,
  now: Date,
) {
  return st === "sent" && !!sentAt && daysBetween(sentAt, now) >= FOLLOW_UP_DAYS;
}

/** Limite d'envoi équivalente pour la liste : envoyé avant ce moment = à relancer. */
export function followUpCutoff(now: Date) {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
      (FOLLOW_UP_DAYS - 1) * DAY,
  );
}

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

/* ------------------------------------------------------------------ */
/* Classes d'architectes                                               */
/* ------------------------------------------------------------------ */

export type ArchitectClass = {
  id: number;
  name: string;
  /** Remise en pour cent. */
  discount: number;
  /** Chiffre accepté HTVA sur 12 mois, en centimes, pour y entrer. */
  threshold: number;
};

export type ClassStatus = {
  current: ArchitectClass | null;
  next: ArchitectClass | null;
  /** Centimes HTVA qu'il reste à accepter pour la classe suivante. */
  remaining: number;
  /** Avancement vers la classe suivante, de 0 à 1. */
  progress: number;
  /** Chiffre accepté HTVA sur 12 mois, en centimes. */
  volume: number;
  /** La classe vient du chiffre (et non du seul choix de Mikado Deco). */
  earned: boolean;
  /**
   * Classe gardée par la garantie de 12 mois alors que le chiffre actuel est
   * passé sous son palier : date de fin (AAAA-MM-JJ) et centimes HTVA à
   * accepter d'ici là pour la garder. Null sinon.
   */
  guarantee: { until: string; keep: number; soon: boolean } | null;
  /**
   * Bienvenue : « open » tant que le compte a moins de 60 jours et aucun devis
   * accepté (le premier comptera double), « counted » quand il a compté double.
   */
  welcome: "open" | "counted" | null;
};

/** Classes de la plus basse à la plus haute : palier, puis remise. */
export function sortClasses(classes: ArchitectClass[]) {
  return [...classes].sort(
    (a, b) =>
      a.threshold - b.threshold || a.discount - b.discount || a.id - b.id,
  );
}

/**
 * Classe d'un architecte : la plus haute entre celle que Mikado Deco a choisie
 * (un minimum) et celle que son chiffre des 12 derniers mois lui ouvre.
 */
export function classStatus(
  classes: ArchitectClass[],
  assignedId: number | null,
  volume: number,
  // Plus haut chiffre atteint sur l'année (garantie de 12 mois) : il fixe la
  // classe gagnée, le chiffre actuel fixe ce qui reste à faire.
  peak = volume,
): ClassStatus {
  const sorted = sortClasses(classes);
  const reached = Math.max(volume, peak);
  const earnedIndex = sorted.reduce(
    (best, c, i) => (c.threshold <= reached ? i : best),
    -1,
  );
  const assignedIndex = sorted.findIndex((c) => c.id === assignedId);
  const index = Math.max(earnedIndex, assignedIndex);
  const current = index >= 0 ? sorted[index] : null;
  const next =
    sorted
      .slice(index + 1)
      .find(
        (c) => c.discount > (current?.discount ?? -1) && c.threshold > reached,
      ) || null;
  const remaining = next ? Math.max(0, next.threshold - volume) : 0;
  const progress = next
    ? next.threshold
      ? Math.min(1, volume / next.threshold)
      : 1
    : 1;
  return {
    current,
    next,
    remaining,
    progress,
    volume,
    earned: index >= 0 && index === earnedIndex && earnedIndex >= assignedIndex,
    guarantee: null,
    welcome: null,
  };
}

/* ------------------------------------------------------------------ */
/* Fidélité : garantie de 12 mois et premier devis de bienvenue        */
/* ------------------------------------------------------------------ */

/** Un devis accepté : sa date et son montant HTVA en centimes. */
export type Accepted = { at: Date; amount: number };

/** Une classe atteinte reste acquise 12 mois après le devis qui l'a ouverte. */
export const GUARANTEE_DAYS = 365;
/** L'accueil prévient ce nombre de jours avant la fin de la garantie. */
export const GUARANTEE_ALERT_DAYS = 60;
/** Le premier devis accepté compte double s'il l'est dans ces jours. */
export const WELCOME_DAYS = 60;

const days = (d: Date, n: number) => new Date(d.getTime() + n * DAY);

/** Chiffre des 12 mois qui finissent au jour `at`, inclus. */
export function rollingVolume(items: Accepted[], at: Date) {
  const since = days(at, -GUARANTEE_DAYS).getTime();
  return items.reduce(
    (sum, i) =>
      i.at.getTime() > since && i.at.getTime() <= at.getTime()
        ? sum + i.amount
        : sum,
    0,
  );
}

/**
 * Classe d'un architecte avec les leviers de fidélité :
 * - le premier devis accepté dans les 60 jours qui suivent l'ouverture du
 *   compte compte double ;
 * - une classe atteinte reste acquise 12 mois après le devis accepté qui l'a
 *   ouverte ou confirmée, même si le chiffre glissant baisse ensuite.
 */
export function loyaltyStatus(
  classes: ArchitectClass[],
  assignedId: number | null,
  accepted: Accepted[],
  createdAt: Date | null,
  now: Date,
): ClassStatus {
  const sorted = [...accepted].sort((a, b) => a.at.getTime() - b.at.getTime());
  const first = sorted[0];
  const welcome =
    !!first &&
    !!createdAt &&
    first.at.getTime() - createdAt.getTime() <= WELCOME_DAYS * DAY &&
    first.at.getTime() >= createdAt.getTime() - DAY;
  const items = sorted.map((i, n) =>
    n === 0 && welcome ? { ...i, amount: i.amount * 2 } : i,
  );
  const volume = rollingVolume(items, now);
  const since = days(now, -GUARANTEE_DAYS).getTime();
  const points = items
    .filter((i) => i.at.getTime() > since && i.at.getTime() <= now.getTime())
    .map((i) => ({ at: i.at, volume: rollingVolume(items, i.at) }));
  const peak = points.reduce((m, p) => Math.max(m, p.volume), volume);
  const status = classStatus(classes, assignedId, volume, peak);
  const c = status.current;
  let guarantee: ClassStatus["guarantee"] = null;
  if (status.earned && c && volume < c.threshold) {
    const last = points.filter((p) => p.volume >= c.threshold).pop();
    if (last) {
      const until = days(last.at, GUARANTEE_DAYS);
      guarantee = {
        until: until.toISOString().slice(0, 10),
        keep: c.threshold - volume,
        soon: daysBetween(now, until) <= GUARANTEE_ALERT_DAYS,
      };
    }
  }
  const open =
    !first &&
    !!createdAt &&
    now.getTime() - createdAt.getTime() <= WELCOME_DAYS * DAY;
  return {
    ...status,
    guarantee,
    welcome: welcome ? "counted" : open ? "open" : null,
  };
}

/** « 10 % », « 12,5 % ». */
export const percent = (n: number) =>
  `${n.toLocaleString("fr-BE", { maximumFractionDigits: 2 })} %`;
