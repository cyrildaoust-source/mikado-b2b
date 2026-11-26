import db from "../db.server";
import {
  commercialStatus,
  quoteSchema,
  selectedLines,
  totals,
} from "../domain/quote";
import {
  FOLLOW_UP_DAYS,
  arrivalWindow,
  daysBetween,
  deliveryLabel,
  editingAfterRelease,
  quoteLeadTime,
  stage,
  validityLeft,
  type Stage,
} from "../domain/dashboard";
import { gql, type Admin } from "./shopify-api.server";

// Tableau de bord : les devis du compte (tous pour Mikado Deco), classés par
// étape, avec les délais des produits et l'état des commandes Shopify.
// Lecture seule : rien n'est écrit, ni en base ni dans Shopify.

/** Au-delà, le tableau de bord ne lit que les devis les plus récents. */
const LIMIT = 300;

export type DashboardQuote = {
  id: number;
  number: string | null;
  title: string;
  customer: string;
  owner: string | null;
  stage: Stage;
  /** Statut affiché dans la liste des devis (« Brouillon », « Envoyé · R2 »…). */
  label: string;
  /** Nouvelle version en cours après la dernière révision prête. */
  editing: boolean;
  total: number;
  updatedAt: string;
  sentAt: string | null;
  sentDays: number | null;
  revision: number | null;
  validity: string | null;
  validityLeft: number | null;
  orderName: string | null;
  /** Commande confirmée dans Shopify (sinon commande provisoire). */
  confirmed: boolean;
  orderedAt: string | null;
  delivery: string | null;
  lead: string | null;
  leadMissing: number;
  leadProducts: number;
  arrival: { from: string; to: string } | null;
};

export type Dashboard = {
  quotes: DashboardQuote[];
  counts: Record<Stage, number>;
  sentTotal: number;
  orderedTotal: number;
  followUps: number;
  /** Délais ou commandes non lus (Shopify indisponible). */
  shopifyError: boolean;
  truncated: boolean;
};

const leadTimeQuery = `query LeadTimes($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant { id product { id leadTime: metafield(namespace: "custom", key: "lead_time") { value } } } } }`;
const ordersQuery = `query DashboardOrders($ids: [ID!]!) { nodes(ids: $ids) { ... on Order { id name displayFulfillmentStatus cancelledAt processedAt } } }`;

export const dashboardOperations = { leadTimeQuery, ordersQuery };

type OrderInfo = {
  id: string;
  name: string;
  displayFulfillmentStatus: string | null;
  cancelledAt: string | null;
  processedAt: string | null;
};

function chunks<T>(list: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Délais fictifs du mode local, stables d'un chargement à l'autre. */
const DEMO_LEAD = ["3-4 semaines", "7-10 jours ouvrés", "6-10 semaines", null];
function demoLead(id: string) {
  const n = [...id].reduce((a, c) => a + c.charCodeAt(0), 0);
  return DEMO_LEAD[n % DEMO_LEAD.length];
}

async function leadTimes(admin: Admin | null, demo: boolean, ids: string[]) {
  const map = new Map<string, string | null>();
  if (!ids.length) return map;
  if (!admin) {
    if (demo) ids.forEach((id) => map.set(id, demoLead(id)));
    return map;
  }
  for (const part of chunks(ids, 100)) {
    const data = await gql<{
      nodes: ({
        id: string;
        product: { leadTime: { value: string } | null } | null;
      } | null)[];
    }>(admin, leadTimeQuery, { ids: part });
    for (const n of data.nodes)
      if (n?.id) map.set(n.id, n.product?.leadTime?.value ?? null);
  }
  return map;
}

async function orders(admin: Admin | null, ids: string[]) {
  const map = new Map<string, OrderInfo>();
  const real = ids.filter((id) => /^gid:\/\/shopify\/Order\/\d+$/.test(id));
  if (!admin || !real.length) return map;
  for (const part of chunks(real, 100)) {
    const data = await gql<{ nodes: (OrderInfo | null)[] }>(
      admin,
      ordersQuery,
      {
        ids: part,
      },
    );
    for (const n of data.nodes) if (n?.id) map.set(n.id, n);
  }
  return map;
}

export async function loadDashboard(
  shop: string,
  owner: number | null,
  admin: Admin | null,
  demo: boolean,
  now = new Date(),
): Promise<Dashboard> {
  const rows = await db.quote.findMany({
    where: {
      shop,
      status: { notIn: ["archived", "deleted"] },
      ...(owner === null ? {} : { ownerId: owner }),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: LIMIT + 1,
    include: {
      owner: { select: { name: true } },
      conversion: {
        select: {
          status: true,
          orderStatus: true,
          orderId: true,
          orderName: true,
          draftName: true,
          acceptedAt: true,
          updatedAt: true,
        },
      },
      revisions: {
        where: { publishedNumber: { not: null } },
        orderBy: { version: "desc" },
        select: {
          version: true,
          publishedNumber: true,
          sentAt: true,
          pdfGeneratedAt: true,
        },
      },
    },
  });
  const truncated = rows.length > LIMIT;
  const parsed = rows.slice(0, LIMIT).flatMap((q) => {
    const st = stage(q);
    if (!st) return [];
    let state;
    try {
      state = quoteSchema.parse(JSON.parse(q.state));
    } catch {
      return [];
    }
    const variants = selectedLines(state)
      .map((l) => l.variantId)
      .filter((v): v is string => !!v);
    return [{ q, st, state, variants }];
  });

  // Les délais ne servent qu'aux devis encore ouverts ou commandés.
  let shopifyError = false;
  let lead = new Map<string, string | null>(),
    orderMap = new Map<string, OrderInfo>();
  try {
    lead = await leadTimes(admin, demo, [
      ...new Set(parsed.flatMap((p) => p.variants)),
    ]);
  } catch {
    shopifyError = true;
  }
  try {
    orderMap = await orders(
      admin,
      parsed.flatMap((p) =>
        p.st === "ordered" && p.q.conversion?.orderId
          ? [p.q.conversion.orderId]
          : [],
      ),
    );
  } catch {
    shopifyError = true;
  }

  const counts: Record<Stage, number> = {
    draft: 0,
    ready: 0,
    sent: 0,
    ordered: 0,
    check: 0,
  };
  let sentTotal = 0,
    orderedTotal = 0,
    followUps = 0;
  const quotes = parsed.map(({ q, st, state, variants }): DashboardQuote => {
    counts[st]++;
    const total = totals(state).total;
    const released = q.revisions.find(
      (r) => r.publishedNumber && r.pdfGeneratedAt,
    );
    const sentAt =
      st === "sent" && released?.sentAt ? new Date(released.sentAt) : null;
    const sentDays = sentAt ? daysBetween(sentAt, now) : null;
    if (st === "sent") {
      sentTotal += total;
      if ((sentDays ?? 0) >= FOLLOW_UP_DAYS) followUps++;
    }
    const c = q.conversion;
    const order = c?.orderId ? orderMap.get(c.orderId) : undefined;
    const confirmed = st === "ordered" && c?.orderStatus === "complete";
    // L'arrivée se compte depuis la commande confirmée, pas depuis le brouillon.
    const orderedAt = confirmed
      ? new Date(
          order?.processedAt || c?.acceptedAt || c?.updatedAt || q.updatedAt,
        )
      : null;
    if (st === "ordered") orderedTotal += total;
    const lt =
      shopifyError && !lead.size ? null : quoteLeadTime(variants, lead);
    const win = orderedAt && lt ? arrivalWindow(orderedAt, lt.longest) : null;
    return {
      id: q.id,
      number: q.number,
      title: q.title,
      customer: q.customer,
      owner: q.owner?.name || null,
      stage: st,
      label: commercialStatus(q),
      editing: editingAfterRelease(q),
      total,
      updatedAt: q.updatedAt.toISOString(),
      sentAt: sentAt?.toISOString() || null,
      sentDays,
      revision: released?.publishedNumber ?? null,
      validity: state.validity || null,
      validityLeft: validityLeft(state.validity, now),
      orderName: order?.name || c?.orderName || c?.draftName || null,
      confirmed,
      orderedAt: orderedAt?.toISOString() || null,
      delivery: order
        ? deliveryLabel(order.displayFulfillmentStatus, !!order.cancelledAt)
        : null,
      lead: lt?.longest?.text ?? null,
      leadMissing: lt?.missing ?? 0,
      leadProducts: lt?.products ?? 0,
      arrival: win
        ? { from: win.from.toISOString(), to: win.to.toISOString() }
        : null,
    };
  });
  return {
    quotes,
    counts,
    sentTotal,
    orderedTotal,
    followUps,
    shopifyError,
    truncated,
  };
}
