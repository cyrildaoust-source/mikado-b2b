import db from "../db.server";
import { getQuote } from "./quotes.server";
import { billingMode } from "./billing-v2.server";
import { quoteSchema, fiscalTotals, cents } from "../domain/quote";
import { gql, verifyCreatedDraft, type Admin } from "./shopify-api.server";
export const orderOperations = {
  lookup: `query CompletedOrder($id: ID!) { draftOrder(id:$id) { id order { id name displayFinancialStatus cancelledAt totalPriceSet { presentmentMoney { amount currencyCode } } } } }`,
  // Explicitly pinned to Admin API 2026-07. paymentPending remains supported but deprecated.
  complete: `mutation CompleteUnpaid($id: ID!) { draftOrderComplete(id:$id,paymentPending:true) { draftOrder { id order { id name displayFinancialStatus } } userErrors { field message } } }`,
  inspect: `query BillingOrder($id: ID!) { order(id:$id) { id name displayFinancialStatus cancelledAt totalPriceSet { presentmentMoney { amount currencyCode } } } }`,
};
type ShopifyOrder = {
  id: string;
  name: string;
  displayFinancialStatus: string;
  cancelledAt: string | null;
  totalPriceSet: { presentmentMoney: { amount: string; currencyCode: string } };
};
export async function checkBillingOrder(
  admin: Admin,
  orderId: string,
  gross: number,
) {
  const { order } = await gql<{ order: ShopifyOrder | null }>(
    admin,
    orderOperations.inspect,
    { id: orderId },
  );
  if (
    !order ||
    order.cancelledAt ||
    order.totalPriceSet.presentmentMoney.currencyCode !== "EUR" ||
    cents(order.totalPriceSet.presentmentMoney.amount) !== gross
  )
    throw Error(
      "La commande Shopify est annulée ou ses montants ont changé. Vérifiez-la avant facturation.",
    );
  if (order.displayFinancialStatus !== "PENDING")
    throw Error(
      "Le paiement Shopify a changé : rapprochez-le avec Odoo avant de facturer.",
    );
}
export async function acceptOrder(
  shop: string,
  id: number,
  version: number,
  admin: Admin | null,
) {
  const q = await getQuote(shop, id),
    s = quoteSchema.parse(JSON.parse(q.state));
  if (
    s.taxPolicy !== "BE21" ||
    (s.billingSame ? s.shipping : s.billing).countryCode !== "BE"
  )
    throw Error(
      "Le circuit Odoo automatique est réservé aux devis belges à 21 % pour cette première version.",
    );
  const revision = q.revisions.find(
    (r) => r.version === version && r.publishedNumber && r.pdfGeneratedAt,
  );
  if (
    q.version !== version ||
    !revision ||
    ["archived", "deleted"].includes(q.status)
  )
    throw Error(
      "Préparez et vérifiez le PDF de cette version avant d’accepter le devis.",
    );
  if (billingMode(shop) === "disabled")
    throw Error(
      "Configurez les connecteurs avant de confirmer une commande réelle.",
    );
  if (billingMode(shop) === "simulation") {
    await db.$transaction(async (tx) => {
      await tx.conversion.upsert({
        where: { quoteId: id },
        create: {
          quoteId: id,
          version,
          preview: "{}",
          status: "complete",
          orderId: `simulation:${id}`,
          orderName: `TEST-${id}`,
          orderStatus: "complete",
          acceptedAt: new Date(),
        },
        update: {
          orderId: `simulation:${id}`,
          orderName: `TEST-${id}`,
          orderStatus: "complete",
          acceptedAt: new Date(),
          status: "complete",
        },
      });
      await tx.quote.update({ where: { id }, data: { status: "converted" } });
    });
    return;
  }
  const c = q.conversion;
  if (!admin || c?.status !== "complete" || !c.draftId)
    throw Error("Créez et vérifiez d’abord la commande provisoire Shopify.");
  if (c.orderId && c.orderStatus === "complete") return;
  const recover = async () => {
    const { draftOrder } = await gql<{
      draftOrder: { order: ShopifyOrder | null } | null;
    }>(admin, orderOperations.lookup, { id: c.draftId });
    const order = draftOrder?.order;
    if (!order) return false;
    // Persist the external identifier even if validation subsequently fails.
    await db.conversion.update({
      where: { id: c.id },
      data: {
        orderId: order.id,
        orderName: order.name,
        orderStatus: "uncertain",
      },
    });
    await checkBillingOrder(admin, order.id, fiscalTotals(s).gross);
    await db.conversion.update({
      where: { id: c.id },
      data: { orderStatus: "complete", acceptedAt: new Date(), error: null },
    });
    return true;
  };
  if (await recover()) return;
  if (c.orderStatus)
    throw Error(
      "Conversion en cours ou incertaine : aucune nouvelle commande ne sera créée. Vérifiez Shopify.",
    );
  await verifyCreatedDraft(
    admin,
    c.draftId,
    s,
    JSON.parse(revision.calculation!),
  );
  const claimed = await db.conversion.updateMany({
    where: { id: c.id, orderStatus: null },
    data: { orderStatus: "creating" },
  });
  if (claimed.count !== 1) throw Error("Confirmation déjà en cours.");
  try {
    const data = await gql<{
      draftOrderComplete: { userErrors: { message: string }[] };
    }>(admin, orderOperations.complete, { id: c.draftId });
    if (data.draftOrderComplete.userErrors.length)
      throw Error("Shopify a refusé la finalisation. Vérifiez la commande.");
    if (!(await recover()))
      throw Error("Commande non retrouvée après confirmation.");
  } catch (error) {
    await db.conversion.update({
      where: { id: c.id },
      data: {
        orderStatus: "uncertain",
        error: "Finalisation à vérifier dans Shopify.",
      },
    });
    throw error;
  }
}
