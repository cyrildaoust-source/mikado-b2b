import db from "../db.server";
import { sellerSnapshot } from "./seller.server";
import { getQuote } from "./quotes.server";
import { quoteSchema, reference, fiscalTotals } from "../domain/quote";
import {
  prepareCalculation,
  createDraft,
  verifyCreatedDraft,
  recoverDraft,
  definiteRejection,
  type Admin,
  type Calculation,
} from "./shopify-api.server";
const blocked = ["creating", "uncertain", "complete"];
export function conversionTag(id: string) {
  return `mikado-${id}`;
}
export async function previewConversion(
  shop: string,
  id: number,
  version: number,
  admin: Admin | null,
) {
  const q = await getQuote(shop, id);
  if (q.status !== "draft" || q.version !== version)
    throw Error("Rechargez le devis avant calcul.");
  const c = await db.$transaction(async (tx) => {
    const current = await tx.quote.findFirst({
      where: { id, shop, version, status: "draft" },
      include: { conversion: true },
    });
    if (
      !current ||
      (current.conversion && blocked.includes(current.conversion.status))
    )
      throw Error("Devis modifié ou conversion en cours.");
    return tx.conversion.upsert({
      where: { quoteId: id },
      create: { quoteId: id, version, preview: "null" },
      update: { version, status: "preview", preview: "null", error: null },
    });
  });
  const { calculation } = await prepareCalculation(
    admin,
    quoteSchema.parse(JSON.parse(q.state)),
    q.number || reference(id, q.createdAt),
    conversionTag(c.id),
  );
  const changed = await db.conversion.updateMany({
    where: {
      id: c.id,
      version,
      status: "preview",
      quote: { shop, version, status: "draft" },
    },
    data: { preview: JSON.stringify(calculation) },
  });
  if (changed.count !== 1) throw Error("Devis modifié pendant le calcul.");
  return calculation;
}
export async function publishQuote(
  shop: string,
  id: number,
  version: number,
  admin: Admin | null,
) {
  const q = await getQuote(shop, id);
  if (q.revisions.find((r) => r.version === version)?.publishedNumber) return;
  const state=quoteSchema.parse(JSON.parse(q.state));
  if(state.taxPolicy !== "BE21")throw Error("Vérifiez le passage à 21 % de cet ancien devis avant de créer une nouvelle version.");
  const hasDelivery = Boolean(state.shipping.address1.trim() && state.shipping.city.trim() && state.shipping.zip.trim());
  if (!fiscalTotals(state).complete) throw Error("Vérifiez les prix avant de préparer le PDF.");
  // An offer can be issued before delivery details are known; order creation still validates Shopify taxes.
  const calculation = hasDelivery ? await previewConversion(shop, id, version, admin) : null;
  if (calculation && !calculation.matches)
    throw Error(
      "Les montants Shopify diffèrent du devis. Corrigez l’écart avant de figer.",
    );
  return db.$transaction(async (tx) => {
    const current = await tx.quote.findFirst({
      where: { id, shop, version, status: "draft" },
      include: { conversion: true },
    });
    if (
      !current ||
      (current.conversion && blocked.includes(current.conversion.status)) ||
      (calculation && (current.conversion?.status !== "preview" ||
      current.conversion.preview !== JSON.stringify(calculation)))
    )
      throw Error("Le devis a changé.");
    const r = await tx.revision.findUniqueOrThrow({
      where: { quoteId_version: { quoteId: id, version } },
    });
    if (r.publishedNumber) return;
    const max = await tx.revision.aggregate({
      where: { quoteId: id },
      _max: { publishedNumber: true },
    });
    await tx.revision.update({
      where: { id: r.id },
      data: {
        publishedNumber: (max._max.publishedNumber || 0) + 1,
        issuedAt: new Date(),
        documentMeta: JSON.stringify(sellerSnapshot()),
        calculation: calculation ? JSON.stringify(calculation) : null,
      },
    });
  });
}
async function complete(id: number, d: { id: string; name: string }) {
  return db.$transaction(async (tx) => {
    await tx.quote.update({ where: { id }, data: { status: "converted" } });
    return tx.conversion.update({
      where: { quoteId: id },
      data: {
        status: "complete",
        draftId: d.id,
        draftName: d.name,
        error: null,
      },
    });
  });
}
export async function convertQuote(
  shop: string,
  id: number,
  version: number,
  admin: Admin | null,
) {
  if (!admin) throw Error("Conversion indisponible en mode local.");
  const q = await getQuote(shop, id),
    c = q.conversion;
  if (c?.status === "complete") return c;
  const publication = q.revisions.find(
    (r) => r.version === version && r.publishedNumber,
  );
  if (!publication?.calculation || !publication.pdfGeneratedAt)
    throw Error("Figez cette révision avant conversion.");
  if (
    !c ||
    c.status !== "preview" ||
    q.version !== version ||
    c.version !== version ||
    q.status !== "draft"
  )
    throw Error("Recalculez le devis avant création.");
  const tag = conversionTag(c.id),
    s = quoteSchema.parse(JSON.parse(q.state));
  const { input, calculation: fresh } = await prepareCalculation(
    admin,
    s,
    `${q.number || reference(id, q.createdAt)} / R${publication.publishedNumber}`,
    tag,
  );
  const old = JSON.parse(publication.calculation) as Calculation;
  if (
    !fresh.matches ||
    old.demo ||
    JSON.stringify(fresh) !== JSON.stringify(old)
  )
    throw Error(
      "Les montants ont changé depuis l’émission. Préparez une nouvelle révision.",
    );
  await db.$transaction(async (tx) => {
    const current = await tx.quote.findFirst({
      where: { id, shop, version, status: "draft" },
    });
    if (!current) throw Error("Le devis a changé.");
    const claim = await tx.conversion.updateMany({
      where: { id: c.id, version, status: "preview" },
      data: { status: "creating" },
    });
    if (claim.count !== 1) throw Error("Conversion déjà en cours.");
  });
  try {
    const found = await recoverDraft(admin, tag);
    if (found.length === 1)
      return await verifyAndComplete(shop, id, admin, found[0]);
    if (found.length > 1)
      throw Error("Plusieurs commandes portent la référence.");
  } catch {
    await db.conversion.update({
      where: { id: c.id },
      data: {
        status: "uncertain",
        error: "Recherche préalable impossible. Vérifiez Shopify.",
      },
    });
    throw Error(
      "Recherche préalable impossible. Vérifiez Shopify avant toute création.",
    );
  }
  try {
    const d = await createDraft(admin, input);
    return await verifyAndComplete(shop, id, admin, d);
  } catch (error) {
    const rejected = definiteRejection(error);
    await db.conversion.updateMany({
      where: { id: c.id, status: "creating" },
      data: {
        status: rejected ? "rejected" : "uncertain",
        error: rejected
          ? "Requête refusée. Corrigez les accès ou les données puis recalculez."
          : "Réponse interrompue. Vérifiez Shopify avant toute nouvelle tentative.",
      },
    });
    throw Error(
      rejected
        ? "Shopify a refusé la création. Corrigez la cause puis recalculez."
        : "Résultat incertain : utilisez « Vérifier dans Shopify ». Aucune commande ne sera recréée automatiquement.",
    );
  }
}
export async function reconcile(shop: string, id: number, admin: Admin | null) {
  if (!admin) throw Error("Shopify non connecté.");
  const q = await getQuote(shop, id);
  if (!q.conversion || !["creating", "uncertain"].includes(q.conversion.status))
    throw Error("Aucune conversion à vérifier.");
  const results = await recoverDraft(
    admin,
    conversionTag(q.conversion.id),
  );
  if (results.length !== 1)
    throw Error(
      results.length
        ? "Plusieurs commandes retrouvées : vérification manuelle nécessaire."
        : "Aucune commande retrouvée. Le verrou est conservé ; une vérification opérateur est nécessaire.",
    );
  return verifyAndComplete(shop, id, admin, results[0]);
}

async function verifyAndComplete(
  shop: string,
  id: number,
  admin: Admin,
  d: { id: string; name: string },
) {
  const q = await getQuote(shop, id),
    r = q.revisions.find(
      (r) => r.version === q.conversion?.version && r.publishedNumber,
    );
  await db.conversion.update({
    where: { quoteId: id },
    data: { draftId: d.id, draftName: d.name },
  });
  try {
    if (!r?.calculation) throw Error("Version de référence introuvable.");
    const verified = await verifyCreatedDraft(
      admin,
      d.id,
      quoteSchema.parse(JSON.parse(q.state)),
      JSON.parse(r.calculation),
    );
    return await complete(id, verified);
  } catch (error) {
    await db.conversion.update({
      where: { quoteId: id },
      data: {
        status: "uncertain",
        error:
          error instanceof Error ? error.message : "Vérification impossible",
      },
    });
    throw error;
  }
}
