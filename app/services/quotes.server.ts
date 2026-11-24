import { Prisma } from "@prisma/client";
import db from "../db.server";
import { quoteSchema, emptyQuote, type QuoteState } from "../domain/quote";
export async function listQuotes(
  shop: string,
  search = "",
  filter = "all",
  page = 1,
  owner: number | null = null,
) {
  const term = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
  const states: Record<string, Prisma.Sql> = {
    archived: Prisma.sql`q.status = 'archived'`,
    deleted: Prisma.sql`q.status = 'deleted'`,
    ordered: Prisma.sql`q.status = 'converted'`,
    draft: Prisma.sql`q.status = 'draft' AND NOT EXISTS(SELECT 1 FROM Revision r WHERE r.quoteId=q.id AND r.version=q.version AND r.pdfGeneratedAt IS NOT NULL)`,
    ready: Prisma.sql`q.status = 'draft' AND EXISTS(SELECT 1 FROM Revision r WHERE r.quoteId=q.id AND r.version=q.version AND r.pdfGeneratedAt IS NOT NULL AND r.sentAt IS NULL)`,
    sent: Prisma.sql`q.status = 'draft' AND EXISTS(SELECT 1 FROM Revision r WHERE r.quoteId=q.id AND r.version=q.version AND r.pdfGeneratedAt IS NOT NULL AND r.sentAt IS NOT NULL)`,
  };
  const ownerSql =
    owner === null ? Prisma.sql`1=1` : Prisma.sql`q.ownerId=${owner}`;
  const where = Prisma.sql`q.shop=${shop} AND ${ownerSql} AND (q.title LIKE ${term} ESCAPE '\\' OR q.customer LIKE ${term} ESCAPE '\\' OR q.number LIKE ${term} ESCAPE '\\') AND ${states[filter] || Prisma.sql`q.status NOT IN ('archived', 'deleted')`}`;
  const count = await db.$queryRaw<{ n: bigint }[]>(
    Prisma.sql`SELECT COUNT(*) as n FROM Quote q WHERE ${where}`,
  );
  const total = Number(count[0].n),
    pages = Math.max(1, Math.ceil(total / 25)),
    current = Math.min(Math.max(1, page), pages);
  const ids = await db.$queryRaw<{ id: number }[]>(
    Prisma.sql`SELECT q.id FROM Quote q WHERE ${where} ORDER BY q.updatedAt DESC,q.id DESC LIMIT 25 OFFSET ${(current - 1) * 25}`,
  );
  const quotes = await db.quote.findMany({
    where: { shop, id: { in: ids.map((q) => q.id) } },
    // ownerId déjà filtré par la requête ci-dessus.
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    include: {
      conversion: { select: { status: true } },
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
  return { quotes, total, page: current, pages };
}
export async function getQuote(shop: string, id: number) {
  if (!Number.isSafeInteger(id) || id < 1)
    throw new Response("Devis introuvable", { status: 404 });
  const q = await db.quote.findFirst({
    where: { id, shop },
    include: {
      conversion: true,
      billingRequests: { orderBy: { createdAt: "asc" } },
      revisions: {
        select: {
          version: true,
          createdAt: true,
          publishedNumber: true,
          issuedAt: true,
          sentAt: true,
          calculation: true,
          pdfGeneratedAt: true,
          documentMeta: true,
        },
        orderBy: { version: "desc" },
      },
    },
  });
  if (!q) throw new Response("Devis introuvable", { status: 404 });
  return q;
}
/** Refuse l'accès à un devis d'une autre architecte (404, sans le révéler). */
export async function assertQuoteAccess(
  shop: string,
  id: number,
  owner: number | null,
) {
  if (owner === null) return;
  if (!Number.isSafeInteger(id) || id < 1)
    throw new Response("Devis introuvable", { status: 404 });
  const q = await db.quote.findFirst({
    where: { id, shop, ownerId: owner },
    select: { id: true },
  });
  if (!q) throw new Response("Devis introuvable", { status: 404 });
}

export async function createQuote(
  shop: string,
  state: QuoteState = emptyQuote(),
  ownerId: number | null = null,
) {
  const s = quoteSchema.parse(state);
  return db.$transaction(async (tx) => {
    const year = new Date().getFullYear();
    const priorCounter = await tx.quoteCounter.aggregate({
      where: { year },
      _max: { value: true },
    });
    const counter = await tx.quoteCounter.upsert({
      where: { shop_year: { shop: "*", year } },
      create: { shop: "*", year, value: (priorCounter._max.value ?? 0) + 1 },
      update: { value: { increment: 1 } },
    });
    return tx.quote.create({
      data: {
        shop,
        number: `MD-${year}-${String(counter.value).padStart(4, "0")}`,
        title: s.project,
        customer: s.client,
        state: JSON.stringify(s),
        ownerId: ownerId || null,
        revisions: { create: { version: 1, state: JSON.stringify(s) } },
      },
    });
  });
}

export async function saveQuote(
  shop: string,
  id: number,
  version: number,
  raw: unknown,
  forceRevision = false,
) {
  const s = quoteSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const q = await tx.quote.findFirst({
      where: { id, shop, version, status: "draft" },
      include: { conversion: true },
    });
    if (!q) throw Error("Le devis a changé. Rechargez-le avant de modifier.");
    if (
      q.conversion &&
      ["creating", "uncertain", "complete"].includes(q.conversion.status)
    )
      throw Error(
        "Ce devis est verrouillé par sa conversion. Dupliquez-le pour un autre projet.",
      );
    if (!forceRevision && q.state === JSON.stringify(s)) return version;
    await tx.quote.update({
      where: { id },
      data: {
        state: JSON.stringify(s),
        title: s.project,
        customer: s.client,
        version: { increment: 1 },
      },
    });
    await tx.revision.create({
      data: { quoteId: id, version: version + 1, state: JSON.stringify(s) },
    });
    await tx.conversion.deleteMany({
      where: { quoteId: id, status: { in: ["preview", "rejected"] } },
    });
    return version + 1;
  });
}
export async function archiveQuote(shop: string, id: number, version: number) {
  return db.$transaction(async (tx) => {
    const q = await tx.quote.findFirst({
      where: { id, shop, version, status: { not: "deleted" } },
      include: { conversion: true },
    });
    if (!q) throw Error("Le devis a changé. Rechargez la page.");
    if (q.conversion && ["creating", "uncertain"].includes(q.conversion.status))
      throw Error("Vérifiez la conversion avant archivage.");
    await tx.quote.update({ where: { id }, data: { status: "archived" } });
  });
}
export async function markSent(shop: string, id: number, version: number) {
  const quote = await getQuote(shop, id);
  if (["archived", "deleted"].includes(quote.status))
    throw Error("Restaurez le devis avant de déclarer son envoi.");
  const result = await db.revision.updateMany({
    where: {
      quoteId: id,
      version,
      publishedNumber: { not: null },
      pdfGeneratedAt: { not: null },
      sentAt: null,
    },
    data: { sentAt: new Date() },
  });
  if (!result.count)
    throw Error("Cette révision est déjà transmise ou n’est pas figée.");
}
export async function restoreRevision(
  shop: string,
  id: number,
  version: number,
  sourceVersion: number,
) {
  await getQuote(shop, id);
  const r = await db.revision.findUnique({
    where: { quoteId_version: { quoteId: id, version: sourceVersion } },
  });
  if (!r) throw Error("Version introuvable.");
  return saveQuote(shop, id, version, JSON.parse(r.state));
}

export async function unarchiveQuote(
  shop: string,
  id: number,
  version: number,
) {
  const q = await getQuote(shop, id);
  const result = await db.quote.updateMany({
    where: { id, shop, version, status: "archived" },
    data: {
      status: q.conversion?.status === "complete" ? "converted" : "draft",
    },
  });
  if (!result.count) throw Error("Ce devis a changé. Rechargez-le.");
}

// La suppression est réversible et ne détruit aucun PDF ni historique.
export async function trashQuote(shop: string, id: number, version: number) {
  return db.$transaction(async (tx) => {
    const q = await tx.quote.findFirst({
      where: { id, shop, version, status: { in: ["draft", "archived"] } },
      include: { conversion: true, billingRequests: true },
    });
    if (!q) throw Error("Ce devis a changé. Rechargez la page.");
    if (
      q.billingRequests.length ||
      (q.conversion &&
        ["creating", "uncertain", "complete"].includes(q.conversion.status))
    )
      throw Error(
        "Ce devis est lié à une commande. Utilisez les archives pour conserver son suivi.",
      );
    await tx.quote.update({ where: { id }, data: { status: "deleted" } });
  });
}
export async function restoreTrashedQuote(
  shop: string,
  id: number,
  version: number,
) {
  const result = await db.quote.updateMany({
    where: { id, shop, version, status: "deleted" },
    data: { status: "draft" },
  });
  if (!result.count) throw Error("Ce devis a changé. Rechargez la page.");
}
