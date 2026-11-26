import db from "../db.server";
import { quoteSchema, totals } from "../domain/quote";
import {
  classStatus,
  sortClasses,
  type ArchitectClass,
} from "../domain/dashboard";

// Classes d'architectes : remise et palier de chiffre, réglés dans « Accès ».
// Le chiffre compte les devis acceptés (commande créée) des 12 derniers mois,
// HTVA, d'après la date de la commande.

const YEAR = 365 * 86400000;

export async function listClasses(): Promise<ArchitectClass[]> {
  const rows = await db.architectClass.findMany({
    select: { id: true, name: true, discount: true, threshold: true },
  });
  return sortClasses(rows);
}

/** Chiffre accepté HTVA par architecte sur 12 mois glissants, en centimes. */
export async function acceptedVolumes(
  shop: string,
  owner: number | null = null,
  now = new Date(),
  // Démo : les devis sans propriétaire comptent, sous l'identifiant 0.
  unowned = false,
) {
  const since = new Date(now.getTime() - YEAR);
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
    select: { ownerId: true, state: true },
  });
  const volumes = new Map<number, number>();
  for (const r of rows) {
    const key = r.ownerId ?? (unowned ? 0 : null);
    if (key === null) continue;
    try {
      const total = totals(quoteSchema.parse(JSON.parse(r.state))).total;
      volumes.set(key, (volumes.get(key) || 0) + total);
    } catch {
      // Un devis illisible ne compte pas : il reste visible dans la liste.
    }
  }
  return volumes;
}

/** Classe d'un architecte pour son tableau de bord. Null si aucune classe n'existe. */
export async function architectStatus(shop: string, userId: number) {
  const [classes, user] = await Promise.all([
    listClasses(),
    db.user.findUnique({ where: { id: userId }, select: { classId: true } }),
  ]);
  if (!classes.length) return null;
  const volume = (await acceptedVolumes(shop, userId)).get(userId) || 0;
  return classStatus(classes, user?.classId ?? null, volume);
}
