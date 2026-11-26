import { useLoaderData, type LoaderFunctionArgs } from "react-router";
import { context, ownerScope } from "../services/context.server";
import { assertQuoteAccess, getQuote } from "../services/quotes.server";
import { reference } from "../domain/quote";
import {
  boardSections,
  getMood,
  listUploads,
  quoteState,
} from "../services/moodboard.server";
import { MoodBoardEditor } from "../components/moodboard/MoodBoardEditor";

export const meta = ({ data }: { data?: { number?: string } }) => [
  { title: `Mood board ${data?.number || ""} · Mikado Deco Pro` },
];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const c = await context(request);
  const id = Number(params.id);
  await assertQuoteAccess(c.shop, id, ownerScope(c));
  const q = await getQuote(c.shop, id);
  if (q.status === "deleted")
    throw new Response("Ce devis est à la corbeille.", { status: 404 });
  const state = await quoteState(q.state);
  const [sections, mood, uploads] = await Promise.all([
    boardSections(state, c.admin),
    getMood(id),
    listUploads(id),
  ]);
  return {
    id,
    number: q.number || reference(id, q.createdAt),
    project: state.project,
    client: state.client,
    sections,
    mood,
    uploads,
  };
}

export default function MoodBoardPage() {
  const data = useLoaderData<typeof loader>();
  return <MoodBoardEditor key={data.id} {...data} />;
}
