import db from "../db.server";
import { quoteSchema, totals } from "../domain/quote";
import {
  GUARANTEE_DAYS,
  loyaltyStatus,
  sortClasses,
  type Accepted,
  type ArchitectClass,
} from "../domain/dashboard";

// Classes d'architectes : remise et palier de chiffre, réglés dans « Accès ».
// Le chiffre compte les devis acceptés (commande créée) des 12 derniers mois,
// HTVA, d'après la date de la commande. La garantie de 12 mois relit l'année
// d'avant : l'historique remonte donc à deux ans.

const HISTORY = 2 * GUARANTEE_DAYS * 86400000;

export async function listClasses(): Promise<ArchitectClass[]> {
  const rows = await db.architectClass.findMany({
    select: { id: true, name: true, discount: true, threshold: true },
  });
  return sortClasses(rows);
}

/** Devis acceptés par architecte sur deux ans : date et montant HTVA en centimes. */
export async function acceptedHistory(
  shop: string,
  owner: number | null = null,
  now = new Date(),
  // Démo : les devis sans propriétaire comptent, sous l'identifiant 0.
  unowned = false,
) {
  const since = new Date(now.getTime() - HISTORY);
  const rows = await db.quote.findMany({
    where: {
      shop,
      status: "converted",
      ...(unowned ? {} : { ownerId: owner === null ? { not: null } : owner }),
      conversion: {
        OR: [
          { acceptedAt: { gte: since } },
          { acceptedAt: null, updatedAt: { gte: since } },
        ],
      },
    },
    select: {
      ownerId: true,
      state: true,
      conversion: { select: { acceptedAt: true, updatedAt: true } },
    },
  });
  const history = new Map<number, Accepted[]>();
  for (const r of rows) {
    const key = r.ownerId ?? (unowned ? 0 : null);
    const at = r.conversion?.acceptedAt || r.conversion?.updatedAt;
    if (key === null || !at) continue;
    try {
      const amount = totals(quoteSchema.parse(JSON.parse(r.state))).total;
      history.set(key, [...(history.get(key) || []), { at, amount }]);
    } catch {
      // Un devis illisible ne compte pas : il reste visible dans la liste.
    }
  }
  return history;
}

/** Classe d'un architecte pour son tableau de bord. Null si aucune classe n'existe. */
export async function architectStatus(
  shop: string,
  userId: number,
  now = new Date(),
) {
  const [classes, user] = await Promise.all([
    listClasses(),
    db.user.findUnique({
      where: { id: userId },
      select: { classId: true, createdAt: true },
    }),
  ]);
  if (!classes.length) return null;
  const accepted = (await acceptedHistory(shop, userId, now)).get(userId) || [];
  return loyaltyStatus(
    classes,
    user?.classId ?? null,
    accepted,
    user?.createdAt ?? null,
    now,
  );
}
