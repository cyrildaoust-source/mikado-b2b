import { randomBytes } from "node:crypto";
import { z } from "zod";
import db from "../db.server";
import { createInvite, normalizeEmail } from "./auth.server";
import { mikadoAlertEmail, sendMail } from "./mail.server";
import {
  commissionLines,
  isReferralCode,
  makeReferralCode,
  referralEnd,
  stageOf,
  totalsOf,
  type CommissionLine,
  type ReferralSale,
  type Stage,
} from "../domain/referral";

// Parrainage : le lien personnel, les demandes d'accès laissées sur ce lien,
// les filleuls et la commission (voir app/domain/referral.ts).

/** Code du lien de l'architecte, créé à la première demande. */
export async function ensureReferralCode(userId: number) {
  const u = await db.user.findUnique({
    where: { id: userId },
    select: { referralCode: true },
  });
  if (!u) throw new Response("Compte introuvable", { status: 404 });
  if (u.referralCode) return u.referralCode;
  for (let i = 0; i < 5; i++) {
    const code = makeReferralCode((n) => randomBytes(n));
    try {
      // Écriture conditionnelle : deux onglets ouverts gardent le même code.
      const done = await db.user.updateMany({
        where: { id: userId, referralCode: null },
        data: { referralCode: code },
      });
      if (done.count) return code;
      const again = await db.user.findUnique({
        where: { id: userId },
        select: { referralCode: true },
      });
      if (again?.referralCode) return again.referralCode;
    } catch {
      // Code déjà pris par un autre compte : on en tire un autre.
    }
  }
  throw new Error("Impossible de créer le lien de parrainage.");
}

/** Parrain d'un lien, s'il a encore un accès actif. */
export async function findReferrer(code: string) {
  if (!isReferralCode(code)) return null;
  const u = await db.user.findUnique({
    where: { referralCode: code },
    select: {
      id: true,
      name: true,
      active: true,
      firm: { select: { name: true, logoMime: true } },
    },
  });
  if (!u || !u.active) return null;
  return {
    id: u.id,
    name: u.name,
    firm: u.firm?.name || "",
  };
}

/** Ventes contresignées ou facturées des filleuls, par filleul. */
async function salesOf(shop: string, userIds: number[]) {
  const map = new Map<number, ReferralSale[]>();
  if (!userIds.length) return map;
  const rows = await db.quoteDecision.findMany({
    where: {
      status: { in: ["signed", "invoiced"] },
      architectSignedAt: { not: null },
      quote: { shop, ownerId: { in: userIds } },
    },
    select: {
      quoteId: true,
      status: true,
      architectSignedAt: true,
      billing: true,
      quote: { select: { ownerId: true } },
    },
  });
  for (const r of rows) {
    const owner = r.quote.ownerId;
    if (owner === null || !r.architectSignedAt) continue;
    let merchandise = 0;
    try {
      const b = JSON.parse(r.billing || "{}") as {
        kind?: string;
        merchandisePro?: number;
      };
      if (b.kind === "architect" && typeof b.merchandisePro === "number")
        merchandise = b.merchandisePro;
    } catch {
      // Montant illisible : pas de commission plutôt qu'une commission fausse.
    }
    map.set(owner, [
      ...(map.get(owner) || []),
      {
        quoteId: r.quoteId,
        signedAt: r.architectSignedAt,
        status: r.status,
        merchandise,
      },
    ]);
  }
  return map;
}

export type Filleul = {
  key: string;
  name: string;
  firm: string;
  stage: Stage;
  since: string;
  /** Fin de la période de commission (ISO), pour un compte créé. */
  until: string | null;
  lines: (Omit<CommissionLine, "signedAt"> & { signedAt: string })[];
  earned: number;
  pending: number;
};

const iso = (d: Date) => d.toISOString();

/** Filleuls d'un parrain, demandes en cours comprises, du plus récent au plus ancien. */
async function filleulsOf(shop: string, referrerId: number) {
  const [users, requests] = await Promise.all([
    db.user.findMany({
      where: { referredById: referrerId },
      select: {
        id: true,
        name: true,
        passwordHash: true,
        createdAt: true,
        referredAt: true,
        firm: { select: { name: true } },
      },
    }),
    db.referralRequest.findMany({
      where: { referrerId, status: "open" },
      select: { id: true, name: true, firm: true, createdAt: true },
    }),
  ]);
  const sales = await salesOf(
    shop,
    users.map((u) => u.id),
  );
  const out: Filleul[] = [
    ...users.map((u) => {
      const from = u.referredAt ?? u.createdAt;
      const lines = commissionLines(sales.get(u.id) || [], from);
      const t = totalsOf(lines);
      return {
        key: `u${u.id}`,
        name: u.name,
        firm: u.firm?.name || "",
        stage: stageOf({
          hasAccount: true,
          ready: !!u.passwordHash,
          sales: lines.length,
        }),
        since: iso(from),
        until: iso(referralEnd(from)),
        lines: lines.map((l) => ({ ...l, signedAt: iso(l.signedAt) })),
        earned: t.earned,
        pending: t.pending,
      };
    }),
    ...requests.map((r) => ({
      key: `r${r.id}`,
      name: r.name,
      firm: r.firm,
      stage: "request" as Stage,
      since: iso(r.createdAt),
      until: null,
      lines: [],
      earned: 0,
      pending: 0,
    })),
  ];
  return out.sort((a, b) => b.since.localeCompare(a.since));
}

/** Page « Parrainage » d'une architecte. */
export async function referralOverview(shop: string, userId: number) {
  const code = await ensureReferralCode(userId);
  const filleuls = await filleulsOf(shop, userId);
  return {
    code,
    filleuls,
    earned: filleuls.reduce((n, f) => n + f.earned, 0),
    pending: filleuls.reduce((n, f) => n + f.pending, 0),
  };
}

/** Vue de Mikado Deco : demandes à traiter, puis chaque parrain et ses filleuls. */
export async function referralAdmin(shop: string) {
  const [requests, parrains, architects] = await Promise.all([
    db.referralRequest.findMany({
      where: { status: "open" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        firm: true,
        email: true,
        phone: true,
        message: true,
        createdAt: true,
        referrer: { select: { id: true, name: true } },
      },
    }),
    db.user.findMany({
      where: {
        OR: [{ referrals: { some: {} } }, { referralRequests: { some: {} } }],
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.user.findMany({
      where: { role: "architect" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, referredById: true },
    }),
  ]);
  const groups = await Promise.all(
    parrains.map(async (p) => {
      const filleuls = await filleulsOf(shop, p.id);
      return {
        id: p.id,
        name: p.name,
        filleuls,
        earned: filleuls.reduce((n, f) => n + f.earned, 0),
        pending: filleuls.reduce((n, f) => n + f.pending, 0),
      };
    }),
  );
  return {
    requests: requests.map((r) => ({ ...r, createdAt: iso(r.createdAt) })),
    groups,
    architects,
  };
}

export const requestInput = z.object({
  name: z.string().trim().min(2, "Indiquez votre nom.").max(150),
  firm: z.string().trim().max(150).default(""),
  email: z.string().trim().email("Vérifiez l'adresse e-mail.").max(250),
  phone: z.string().trim().max(40).default(""),
  message: z.string().trim().max(1000).default(""),
});

export class ReferralRefused extends Error {}

/**
 * Demande d'accès laissée sur un lien de parrainage. Limites : 5 demandes par
 * heure depuis une même adresse, une demande ouverte par e-mail, et rien pour
 * une adresse qui a déjà un accès. Mikado Deco reçoit une alerte.
 */
export async function createReferralRequest(
  referrer: { id: number; name: string },
  raw: Record<string, unknown>,
  ip: string,
) {
  const input = requestInput.parse(raw);
  const email = normalizeEmail(input.email);
  if (ip) {
    const recent = await db.referralRequest.count({
      where: { ip, createdAt: { gte: new Date(Date.now() - 3600000) } },
    });
    if (recent >= 5)
      throw new ReferralRefused(
        "Trop de demandes depuis cette connexion. Réessayez dans une heure.",
      );
  }
  if (await db.user.findUnique({ where: { email }, select: { id: true } }))
    throw new ReferralRefused(
      "Cette adresse a déjà un accès à Mikado Deco Pro. Connectez-vous, ou écrivez à Mikado Deco.",
    );
  const open = await db.referralRequest.findFirst({
    where: { email, status: "open" },
    select: { id: true },
  });
  if (open) return { duplicate: true as const };
  const r = await db.referralRequest.create({
    data: { ...input, email, referrerId: referrer.id, ip },
  });
  await sendMail({
    to: [mikadoAlertEmail()],
    subject: `Parrainage : ${input.name} demande un accès (de la part de ${referrer.name})`,
    text: [
      `${input.name}${input.firm ? `, ${input.firm}` : ""} demande un accès à l'outil pro.`,
      `Parrain : ${referrer.name}.`,
      `E-mail : ${email}${input.phone ? ` · Téléphone : ${input.phone}` : ""}`,
      input.message ? `\nMessage :\n${input.message}` : "",
      "\nCréez l'accès ou écartez la demande dans Parrainage.",
    ].join("\n"),
    replyTo: email,
    idempotencyKey: `referral-request-${r.id}`,
  });
  return { duplicate: false as const };
}

/** Mikado Deco crée l'accès d'une demande : le compte est relié au parrain. */
export async function inviteFromRequest(id: number) {
  const r = await db.referralRequest.findUnique({ where: { id } });
  if (!r || r.status !== "open") throw new ReferralRefused("Demande déjà traitée.");
  const exists = await db.user.findUnique({ where: { email: r.email } });
  if (exists) throw new ReferralRefused("Cet e-mail a déjà un accès.");
  const user = await db.$transaction(async (tx) => {
    const done = await tx.referralRequest.updateMany({
      where: { id, status: "open" },
      data: { status: "invited", handledAt: new Date() },
    });
    if (!done.count) throw new ReferralRefused("Demande déjà traitée.");
    const u = await tx.user.create({
      data: {
        name: r.name,
        email: r.email,
        role: "architect",
        referredById: r.referrerId,
        referredAt: new Date(),
      },
    });
    if (r.firm || r.phone)
      await tx.firmProfile.create({
        data: { userId: u.id, name: r.firm, phone: r.phone, email: r.email },
      });
    await tx.referralRequest.update({ where: { id }, data: { userId: u.id } });
    return u;
  });
  return { user, token: await createInvite(user.id) };
}

export async function dismissRequest(id: number) {
  const done = await db.referralRequest.updateMany({
    where: { id, status: "open" },
    data: { status: "dismissed", handledAt: new Date() },
  });
  if (!done.count) throw new ReferralRefused("Demande déjà traitée.");
}

/** Mikado Deco relie (ou détache) un compte existant à un parrain. */
export async function setReferrer(userId: number, referrerId: number | null) {
  if (referrerId === userId)
    throw new ReferralRefused("Un compte ne peut pas être son propre parrain.");
  if (referrerId !== null) {
    // Pas de boucle : le parrain choisi ne doit pas descendre de ce compte.
    let cur: number | null = referrerId;
    for (let i = 0; cur !== null && i < 50; i++) {
      if (cur === userId)
        throw new ReferralRefused("Ce lien ferait une boucle de parrainage.");
      const next: { referredById: number | null } | null =
        await db.user.findUnique({
          where: { id: cur },
          select: { referredById: true },
        });
      cur = next?.referredById ?? null;
    }
  }
  const u = await db.user.findUnique({
    where: { id: userId },
    select: { referredById: true, createdAt: true },
  });
  if (!u) throw new ReferralRefused("Accès introuvable.");
  await db.user.update({
    where: { id: userId },
    data: {
      referredById: referrerId,
      // La période de commission part de l'ouverture du compte.
      referredAt: referrerId === null ? null : u.createdAt,
    },
  });
}
