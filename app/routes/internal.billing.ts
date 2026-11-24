import { timingSafeEqual } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { processBilling, billingMode } from "../services/billing-v2.server";
import { checkBillingOrder } from "../services/order.server";
import { fiscalTotals, quoteSchema } from "../domain/quote";
export async function action({ request }: ActionFunctionArgs) {
  const expected = process.env.BILLING_WORKER_TOKEN || "",
    supplied = request.headers.get("authorization") || "";
  const a = Buffer.from(supplied),
    b = Buffer.from(`Bearer ${expected}`);
  if (
    request.method !== "POST" ||
    expected.length < 32 ||
    a.length !== b.length ||
    !timingSafeEqual(a, b)
  )
    throw new Response("Accès refusé", { status: 401 });
  const shop = process.env.ODOO_SHOP || "";
  if (billingMode(shop) !== "live")
    return Response.json({ enabled: false, processed: 0 });
  const jobs = await db.billingRequest.findMany({
    where: {
      quote: { shop },
      OR: [
        { status: "queued" },
        {
          status: { in: ["checking", "creating"] },
          updatedAt: { lt: new Date(Date.now() - 15 * 60000) },
        },
        {
          status: { in: ["linked", "uncertain"] },
          updatedAt: { lt: new Date(Date.now() - 5 * 60000) },
        },
      ],
    },
    orderBy: { updatedAt: "asc" },
    take: 5,
    include: { quote: { include: { conversion: true } } },
  });
  const { unauthenticated } = await import("../shopify.server");
  const { admin } = await unauthenticated.admin(shop);
  let errors = 0;
  for (const job of jobs) {
    try {
      if (job.status === "queued")
        await checkBillingOrder(
          admin,
          job.quote.conversion!.orderId!,
          fiscalTotals(quoteSchema.parse(JSON.parse(job.quote.state))).gross,
        );
      await processBilling(job.id);
    } catch {
      errors++;
      await db.billingRequest.updateMany({
        where: { id: job.id, status: "queued" },
        data: {
          status: "error",
          error:
            "Commande Shopify inaccessible ou modifiée : vérifiez avant de réessayer.",
        },
      });
    }
  }
  const recordedErrors = await db.billingRequest.count({
    where: { id: { in: jobs.map((j) => j.id) }, error: { not: null } },
  });
  return Response.json({
    enabled: true,
    processed: jobs.length,
    errors: Math.max(errors, recordedErrors),
  });
}
export function loader() {
  throw new Response("Méthode non autorisée", { status: 405 });
}
