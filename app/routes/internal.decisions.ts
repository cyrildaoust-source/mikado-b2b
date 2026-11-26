import { timingSafeEqual } from "node:crypto";
import type { LoaderFunctionArgs } from "react-router";
import { remindOverdue } from "../services/decision.server";

/**
 * Tâche planifiée Vercel (vercel.json, une fois par jour) : rappels des
 * acceptations sans contresignature après 48 h. Vercel envoie
 * « Authorization: Bearer $CRON_SECRET ». Sans secret configuré, rien ne tourne.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const secret = process.env.CRON_SECRET || "";
  const got = request.headers.get("authorization") || "";
  const want = `Bearer ${secret}`;
  if (
    secret.length < 16 ||
    got.length !== want.length ||
    !timingSafeEqual(Buffer.from(got), Buffer.from(want))
  )
    return new Response("Non autorisé", { status: 401 });
  const n = await remindOverdue();
  return Response.json({ reminded: n });
}
