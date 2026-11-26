import { createHash, randomBytes } from "node:crypto";
import db from "../db.server";
import { quoteSchema, reference } from "../domain/quote";
import type { Seller } from "../domain/seller";

/**
 * Lien en ligne d'un devis. Le jeton (32 octets aléatoires) n'est jamais
 * enregistré : la base garde son empreinte SHA-256. Un seul lien actif par
 * devis ; en créer un nouveau retire l'ancien. Le lien montre toujours la même
 * révision figée, donc les mêmes prix, alternatives et options comprises.
 */
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Un devis vaut un mois au plus après son émission (Cyril, 26/11/2026). */
export const SHARE_MAX_DAYS = 31;

/**
 * Fin du jour de validité, heure de Bruxelles, jamais plus d'un mois après
 * l'émission de la révision.
 */
export function shareExpiry(validity: string, issuedAt: Date, now = new Date()) {
  // 22 h 59 UTC : avant minuit à Bruxelles, en hiver comme en été.
  const cap = new Date(issuedAt.getTime() + SHARE_MAX_DAYS * 86400000);
  const asked = new Date(`${validity}T22:59:59Z`);
  const end = Number.isFinite(asked.getTime()) && asked < cap ? asked : cap;
  if (!Number.isFinite(end.getTime()) || end <= now)
    throw Error(
      "La date de validité du devis est passée. Changez-la, puis préparez une nouvelle version PDF.",
    );
  return end;
}

export async function createShare(
  shop: string,
  quoteId: number,
  version: number,
  userId: number | null,
) {
  const token = randomBytes(32).toString("base64url");
  const share = await db.$transaction(async (tx) => {
    const q = await tx.quote.findFirst({
      where: { id: quoteId, shop, version, status: "draft" },
      select: { id: true },
    });
    if (!q) throw Error("Ce devis a changé. Rechargez la page.");
    const r = await tx.revision.findUnique({
      where: { quoteId_version: { quoteId, version } },
      select: {
        id: true,
        state: true,
        publishedNumber: true,
        pdfGeneratedAt: true,
        issuedAt: true,
      },
    });
    if (!r?.publishedNumber || !r.pdfGeneratedAt)
      throw Error("Préparez le PDF de cette version avant de la partager.");
    const state = quoteSchema.parse(JSON.parse(r.state));
    const expiresAt = shareExpiry(state.validity, r.issuedAt ?? new Date());
    await tx.quoteShare.updateMany({
      where: { quoteId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return tx.quoteShare.create({
      data: {
        quoteId,
        revisionId: r.id,
        tokenHash: hashToken(token),
        createdById: userId,
        expiresAt,
      },
    });
  });
  return { token, expiresAt: share.expiresAt };
}

export async function revokeShares(shop: string, quoteId: number) {
  const q = await db.quote.findFirst({ where: { id: quoteId, shop }, select: { id: true } });
  if (!q) throw Error("Devis introuvable.");
  await db.quoteShare.updateMany({
    where: { quoteId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Lien actif d'un devis, pour l'écran de l'architecte (sans le jeton). */
export async function activeShare(quoteId: number) {
  const s = await db.quoteShare.findFirst({
    where: { quoteId, revokedAt: null },
    orderBy: { createdAt: "desc" },
    include: { revision: { select: { version: true, publishedNumber: true } } },
  });
  if (!s) return null;
  return {
    createdAt: s.createdAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
    expired: s.expiresAt <= new Date(),
    views: s.views,
    lastViewedAt: s.lastViewedAt?.toISOString() ?? null,
    version: s.revision.version,
    publishedNumber: s.revision.publishedNumber,
  };
}
export type ActiveShare = NonNullable<Awaited<ReturnType<typeof activeShare>>>;

/**
 * Révision derrière un lien, ou null si le lien est inconnu, retiré, expiré, ou
 * si le devis n'est plus ouvert. Les causes ne sont pas distinguées pour un
 * jeton inconnu ; un lien connu mais clos le dit au client.
 */
export async function resolveShare(token: string, count = true) {
  if (!TOKEN.test(token)) return { status: "unknown" as const };
  const s = await db.quoteShare.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      quote: {
        select: { id: true, number: true, status: true, createdAt: true },
      },
      revision: {
        select: {
          state: true,
          publishedNumber: true,
          issuedAt: true,
          documentMeta: true,
        },
      },
    },
  });
  if (!s) return { status: "unknown" as const };
  const seller: Seller | null = s.revision.documentMeta
    ? JSON.parse(s.revision.documentMeta)
    : null;
  if (s.revokedAt || s.quote.status === "deleted")
    return { status: "closed" as const, seller };
  if (s.expiresAt <= new Date()) return { status: "expired" as const, seller };
  if (count) {
    const now = new Date();
    await db.quoteShare.update({
      where: { id: s.id },
      data: {
        views: { increment: 1 },
        lastViewedAt: now,
        firstViewedAt: s.firstViewedAt ?? now,
      },
    });
  }
  return {
    status: "open" as const,
    seller,
    shareId: s.id,
    expiresAt: s.expiresAt,
    number: s.quote.number || reference(s.quote.id, s.quote.createdAt),
    publishedNumber: s.revision.publishedNumber || 1,
    issuedAt: s.revision.issuedAt,
    state: quoteSchema.parse(JSON.parse(s.revision.state)),
  };
}

/** PDF de la révision derrière un lien ouvert, sans compter de visite. */
export async function sharePdf(token: string) {
  if (!TOKEN.test(token)) return null;
  const s = await db.quoteShare.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      revokedAt: true,
      expiresAt: true,
      quote: { select: { id: true, number: true, status: true, createdAt: true } },
      revision: { select: { pdf: true, publishedNumber: true } },
    },
  });
  if (!s || s.revokedAt || s.expiresAt <= new Date() || s.quote.status === "deleted")
    return null;
  if (!s.revision.pdf) return null;
  return {
    bytes: Buffer.from(s.revision.pdf),
    name: `${s.quote.number || reference(s.quote.id, s.quote.createdAt)}-R${s.revision.publishedNumber}.pdf`,
  };
}
