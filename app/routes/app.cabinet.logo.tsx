import type { LoaderFunctionArgs } from "react-router";
import { context } from "../services/context.server";
import { getLogo } from "../services/firm.server";

/** Logo du cabinet : son architecte, ou Mikado Deco avec ?compte=. */
export async function loader({ request }: LoaderFunctionArgs) {
  const c = await context(request);
  if (!c.user) throw new Response("Introuvable", { status: 404 });
  const asked = Number(new URL(request.url).searchParams.get("compte"));
  const id = c.user.role === "admin" && asked > 0 ? asked : c.user.id;
  const logo = await getLogo(id);
  if (!logo) throw new Response("Aucun logo", { status: 404 });
  return new Response(new Uint8Array(logo.data), {
    headers: {
      "Content-Type": logo.mime,
      "Cache-Control": "private, no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
