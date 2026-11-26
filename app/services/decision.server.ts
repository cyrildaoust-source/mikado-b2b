import { z } from "zod";
import db from "../db.server";
import { fiscalTotals, money } from "../domain/quote";
import { applyChoices, type Choices } from "../domain/proposal";
import { proPrice, publicMerchandise } from "../domain/pro";
import { architectStatus } from "./classes.server";
import { resolveShare } from "./share.server";
import { appUrl, mikadoAlertEmail, sendMail } from "./mail.server";

/** Délai de contresignature de l'architecte (Cyril, 26/11/2026). */
export const SIGN_HOURS = 48;

const choicesSchema = z.object({
  groups: z.record(z.string().max(100), z.string().max(100)).default({}),
  options: z.record(z.string().max(100), z.boolean()).default({}),
});

export const acceptSchema = z.object({
  firstName: z.string().trim().min(1, "Indiquez votre prénom.").max(80),
  lastName: z.string().trim().min(1, "Indiquez votre nom.").max(80),
  agree: z.literal("on", {
    errorMap: () => ({ message: "Cochez la case d'engagement pour accepter." }),
  }),
  remark: z.string().trim().max(2000).default(""),
  choices: z
    .string()
    .max(20000)
    .transform((raw, ctx) => {
      try {
        return choicesSchema.parse(JSON.parse(raw || "{}"));
      } catch {
        ctx.addIssue({ code: "custom", message: "Choix illisibles." });
        return z.NEVER;
      }
    }),
});

/**
 * Le client accepte la proposition derrière le lien. Les montants sont refaits
 * ici, sur la révision figée et les choix reçus ; la première décision
 * l'emporte (le devis passe de draft à accepted en une seule écriture).
 */
export async function acceptProposal(
  token: string,
  raw: Record<string, unknown>,
  meta: { ip?: string; agent?: string } = {},
) {
  const share = await resolveShare(token, false);
  if (share.status !== "open")
    throw Error("Ce lien n'est plus valable : la proposition ne peut plus être acceptée.");
  const input = acceptSchema.parse(raw);
  const chosen = applyChoices(share.state, input.choices);
  const f = fiscalTotals(chosen);
  if (!f.complete) throw Error("Cette proposition ne peut pas être acceptée en ligne.");
  const now = new Date();
  const decision = await db.$transaction(async (tx) => {
    const s = await tx.quoteShare.findUniqueOrThrow({
      where: { id: share.shareId },
      select: { quoteId: true, revisionId: true },
    });
    const moved = await tx.quote.updateMany({
      where: { id: s.quoteId, status: "draft" },
      data: { status: "accepted" },
    });
    if (moved.count !== 1)
      throw Error("Cette proposition a déjà reçu une réponse.");
    return tx.quoteDecision.create({
      data: {
        quoteId: s.quoteId,
        revisionId: s.revisionId,
        shareId: share.shareId,
        choices: JSON.stringify(input.choices),
        remark: input.remark,
        clientFirstName: input.firstName,
        clientLastName: input.lastName,
        acceptedAt: now,
        acceptedIp: (meta.ip || "").slice(0, 100),
        acceptedAgent: (meta.agent || "").slice(0, 300),
        net: f.net,
        tax: f.tax,
        gross: f.gross,
        deadline: new Date(now.getTime() + SIGN_HOURS * 3600_000),
      },
    });
  });
  await notifyAccepted(decision.id).catch((e) =>
    console.error("[décision] e-mail d'acceptation", e),
  );
  return decision;
}

/** Dernière décision non rouverte d'un devis, pour l'écran du devis. */
export async function currentDecision(quoteId: number) {
  const d = await db.quoteDecision.findFirst({
    where: { quoteId, status: { not: "reopened" } },
    orderBy: { acceptedAt: "desc" },
  });
  if (!d) return null;
  return {
    id: d.id,
    status: d.status,
    clientName: `${d.clientFirstName} ${d.clientLastName}`,
    remark: d.remark,
    acceptedAt: d.acceptedAt.toISOString(),
    deadline: d.deadline.toISOString(),
    late: d.status === "accepted" && d.deadline <= new Date(),
    gross: d.gross,
    net: d.net,
    architectName: d.architectName,
    architectSignedAt: d.architectSignedAt?.toISOString() ?? null,
    dueDate: d.dueDate?.toISOString() ?? null,
    invoicedAt: d.invoicedAt?.toISOString() ?? null,
  };
}
export type CurrentDecision = NonNullable<Awaited<ReturnType<typeof currentDecision>>>;

/** Décision du client derrière un lien, pour la page client. */
export async function decisionForShare(shareId: number) {
  const d = await db.quoteDecision.findFirst({
    where: { shareId, status: { not: "reopened" } },
    orderBy: { acceptedAt: "desc" },
    select: {
      clientFirstName: true,
      clientLastName: true,
      acceptedAt: true,
      choices: true,
      gross: true,
    },
  });
  return d
    ? {
        name: `${d.clientFirstName} ${d.clientLastName}`,
        acceptedAt: d.acceptedAt.toISOString(),
        choices: JSON.parse(d.choices) as Choices,
        gross: d.gross,
      }
    : null;
}

type Actor = { id: number; role: string; name: string } | null;

async function loadForActor(shop: string, quoteId: number, actor: Actor) {
  const d = await db.quoteDecision.findFirst({
    where: { quoteId, status: { not: "reopened" }, quote: { shop } },
    orderBy: { acceptedAt: "desc" },
    include: {
      quote: { select: { ownerId: true, owner: { select: { role: true } } } },
      revision: { select: { state: true } },
    },
  });
  if (!d) throw Error("Aucune acceptation à traiter.");
  const ownedByArchitect = d.quote.owner?.role === "architect";
  // La signature de l'architecte est la sienne : Mikado Deco ne signe que ses propres devis.
  const allowed = ownedByArchitect
    ? actor?.id === d.quote.ownerId
    : actor === null || actor.role === "admin";
  return { d, allowed, ownedByArchitect };
}

/**
 * Contresignature de l'architecte : son nom, la date et l'heure. Le montant que
 * Mikado Deco lui facturera est figé à cet instant : marchandise retenue au
 * prix public moins la remise de sa classe, livraison en % de ce montant.
 */
export async function signDecision(
  shop: string,
  quoteId: number,
  actor: Actor,
  raw: Record<string, unknown>,
) {
  const input = z
    .object({
      name: z.string().trim().min(2, "Indiquez votre nom.").max(120),
      confirm: z.literal("on", {
        errorMap: () => ({ message: "Cochez la confirmation pour signer." }),
      }),
    })
    .parse(raw);
  const { d, allowed, ownedByArchitect } = await loadForActor(shop, quoteId, actor);
  if (!allowed) throw Error("Seul l'architecte du devis peut contresigner.");
  if (d.status !== "accepted") throw Error("Cette acceptation est déjà contresignée.");
  const chosen = applyChoices(JSON.parse(d.revision.state), JSON.parse(d.choices));
  const merchandise = publicMerchandise(chosen);
  let billing: Record<string, unknown>;
  if (ownedByArchitect && d.quote.ownerId) {
    const st = await architectStatus(shop, d.quote.ownerId);
    const discount = st?.current?.discount ?? 0;
    const pro = proPrice(merchandise, discount);
    const fee = chosen.extras.find((e) => e.deliveryFee && e.selected);
    const percent = fee?.chargePercent ?? 0;
    const delivery = Math.round((pro * percent) / 100);
    billing = {
      kind: "architect",
      className: st?.current?.name ?? null,
      discount,
      merchandisePublic: merchandise,
      merchandisePro: pro,
      deliveryPercent: percent,
      delivery,
      net: pro + delivery,
    };
  } else {
    billing = { kind: "direct", net: d.net, gross: d.gross };
  }
  const done = await db.quoteDecision.updateMany({
    where: { id: d.id, status: "accepted" },
    data: {
      status: "signed",
      architectName: input.name,
      architectUserId: actor?.id ?? null,
      architectSignedAt: new Date(),
      billing: JSON.stringify(billing),
    },
  });
  if (done.count !== 1) throw Error("Cette acceptation a changé. Rechargez la page.");
}

/**
 * L'architecte rouvre le devis pour le réviser avant de contresigner. Le lien
 * est retiré ; le client recevra une nouvelle proposition.
 */
export async function reopenDecision(shop: string, quoteId: number, actor: Actor) {
  const { d, allowed } = await loadForActor(shop, quoteId, actor);
  if (!allowed) throw Error("Seul l'architecte du devis peut le rouvrir.");
  if (d.status !== "accepted")
    throw Error("Une acceptation contresignée ne se rouvre plus ici. Contactez Mikado Deco.");
  await db.$transaction([
    db.quoteDecision.update({
      where: { id: d.id },
      data: { status: "reopened", reopenedAt: new Date() },
    }),
    db.quote.updateMany({
      where: { id: quoteId, status: "accepted" },
      data: { status: "draft" },
    }),
    db.quoteShare.updateMany({
      where: { quoteId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
}

/** Mikado Deco note la facture : échéance fixée, la ligne quitte la file. */
export async function markInvoiced(
  shop: string,
  decisionId: number,
  adminId: number | null,
  dueDate: string,
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate))
    throw Error("Choisissez la date d'échéance.");
  const done = await db.quoteDecision.updateMany({
    where: { id: decisionId, status: "signed", quote: { shop } },
    data: {
      status: "invoiced",
      dueDate: new Date(`${dueDate}T12:00:00Z`),
      invoicedAt: new Date(),
      invoicedById: adminId,
    },
  });
  if (done.count !== 1) throw Error("Cette ligne a déjà été traitée. Rechargez la page.");
}

/** File de Mikado Deco : contresignés à facturer, et acceptations en attente. */
export async function invoiceQueue(shop: string) {
  const rows = await db.quoteDecision.findMany({
    where: {
      quote: { shop },
      OR: [
        { status: { in: ["accepted", "signed"] } },
        {
          status: "invoiced",
          invoicedAt: { gte: new Date(Date.now() - 30 * 86400_000) },
        },
      ],
    },
    orderBy: { acceptedAt: "asc" },
    include: {
      quote: {
        select: {
          id: true,
          number: true,
          title: true,
          owner: { select: { name: true, firm: { select: { name: true } } } },
        },
      },
    },
  });
  const now = new Date();
  return rows.map((d) => ({
    id: d.id,
    quoteId: d.quote.id,
    number: d.quote.number || `#${d.quote.id}`,
    project: d.quote.title,
    firm: d.quote.owner?.firm?.name || d.quote.owner?.name || "Mikado Deco",
    client: `${d.clientFirstName} ${d.clientLastName}`,
    status: d.status,
    late: d.status === "accepted" && d.deadline <= now,
    acceptedAt: d.acceptedAt.toISOString(),
    deadline: d.deadline.toISOString(),
    architectSignedAt: d.architectSignedAt?.toISOString() ?? null,
    billing: d.billing ? (JSON.parse(d.billing) as BillingSnapshot) : null,
    clientNet: d.net,
    dueDate: d.dueDate?.toISOString() ?? null,
    invoicedAt: d.invoicedAt?.toISOString() ?? null,
  }));
}
export type BillingSnapshot = {
  kind: "architect" | "direct";
  className?: string | null;
  discount?: number;
  merchandisePublic?: number;
  merchandisePro?: number;
  deliveryPercent?: number;
  delivery?: number;
  net: number;
};

async function contacts(quoteId: number) {
  const q = await db.quote.findUniqueOrThrow({
    where: { id: quoteId },
    select: {
      id: true,
      number: true,
      title: true,
      owner: { select: { email: true, name: true, role: true } },
    },
  });
  const architect = q.owner?.role === "architect" ? q.owner : null;
  return { q, architect, link: `${appUrl()}/app/quotes/${q.id}` };
}

async function notifyAccepted(decisionId: number) {
  const d = await db.quoteDecision.findUniqueOrThrow({ where: { id: decisionId } });
  const { q, architect, link } = await contacts(d.quoteId);
  const who = `${d.clientFirstName} ${d.clientLastName}`;
  const until = d.deadline.toLocaleString("fr-BE", {
    timeZone: "Europe/Brussels",
    dateStyle: "full",
    timeStyle: "short",
  });
  await sendMail({
    to: [architect?.email || mikadoAlertEmail()],
    subject: `${q.number || q.title} : ${who} a accepté la proposition`,
    text: [
      `${who} a accepté la proposition « ${q.title} » (${money(d.gross)} TVAC).`,
      d.remark ? `\nSa remarque : ${d.remark}\n` : "",
      `Vous avez jusqu'au ${until} pour contresigner, ou rouvrir le devis si une révision est nécessaire.`,
      `Sans contresignature, rien n'est facturé.`,
      ``,
      link,
    ].join("\n"),
  });
}

/**
 * Acceptations restées sans contresignature après 48 h : un rappel à
 * l'architecte et une alerte à Mikado Deco, une seule fois. Rien n'est facturé.
 */
export async function remindOverdue(now = new Date()) {
  const late = await db.quoteDecision.findMany({
    where: { status: "accepted", deadline: { lte: now }, remindedAt: null },
    select: { id: true, quoteId: true, clientFirstName: true, clientLastName: true },
    take: 50,
  });
  for (const d of late) {
    const claimed = await db.quoteDecision.updateMany({
      where: { id: d.id, remindedAt: null },
      data: { remindedAt: now },
    });
    if (claimed.count !== 1) continue;
    const { q, architect, link } = await contacts(d.quoteId);
    const who = `${d.clientFirstName} ${d.clientLastName}`;
    const subject = `${q.number || q.title} : contresignature en attente depuis 48 h`;
    const text = [
      `${who} a accepté la proposition « ${q.title} » il y a plus de 48 heures.`,
      `Elle n'est pas encore contresignée : rien n'est facturé.`,
      ``,
      link,
    ].join("\n");
    if (architect) await sendMail({ to: [architect.email], subject, text });
    await sendMail({
      to: [mikadoAlertEmail()],
      subject: `[Mikado Pro] ${subject}`,
      text: `${text}\nArchitecte : ${architect?.name || "Mikado Deco"}`,
    });
  }
  return late.length;
}
