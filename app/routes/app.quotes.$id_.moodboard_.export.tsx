import type { LoaderFunctionArgs } from "react-router";
import { context, ownerScope } from "../services/context.server";
import { assertQuoteAccess, getQuote } from "../services/quotes.server";
import { reference } from "../domain/quote";
import { fileName } from "../domain/moodboard";
import {
  boardSections,
  getMood,
  moodPdf,
  moodPng,
  moodPptx,
  quoteState,
} from "../services/moodboard.server";

const TYPES = {
  pdf: "application/pdf",
  png: "image/png",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
} as const;

/** Export du mood board enregistré : PowerPoint, PDF ou image HD d'une planche. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const c = await context(request);
  const id = Number(params.id);
  await assertQuoteAccess(c.shop, id, ownerScope(c));
  const url = new URL(request.url);
  const format = url.searchParams.get("format") as keyof typeof TYPES;
  if (!(format in TYPES)) throw new Response("Format inconnu", { status: 400 });
  const q = await getQuote(c.shop, id);
  const state = await quoteState(q.state);
  // Ordre des pièces du devis ; les titres viennent des pièces.
  const sections = await boardSections(state, null).catch(() => []);
  const mood = await getMood(id);
  const order = sections.map((s) => s.key);
  const boards = mood.boards
    .filter((b) => b.items.length && (order.includes(b.key) || !order.length))
    .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
    .map((board) => ({
      board,
      title: sections.find((s) => s.key === board.key)?.title || "",
    }));
  const key = url.searchParams.get("board");
  const chosen = key ? boards.filter((b) => b.board.key === key) : boards;
  if (!chosen.length) throw new Response("Planche vide", { status: 404 });
  const number = q.number || reference(id, q.createdAt);
  const name = fileName(
    number,
    "mood board",
    key && chosen.length === 1 ? chosen[0].title : state.project,
  );
  const bytes =
    format === "pdf"
      ? await moodPdf(id, chosen.map((b) => b.board))
      : format === "png"
        ? await moodPng(id, chosen[0].board)
        : await moodPptx(id, chosen, state.project);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": TYPES[format],
      "Content-Disposition": `attachment; filename="${name}.${format}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
