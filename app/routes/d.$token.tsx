import {
  data,
  useActionData,
  useLoaderData,
  type ActionFunctionArgs,
  type HeadersFunction,
  type LoaderFunctionArgs,
} from "react-router";
import { ClientProposal } from "../components/ClientProposal";
import { resolveShare } from "../services/share.server";
import { acceptProposal, decisionForShare } from "../services/decision.server";
import { ZodError } from "zod";

/**
 * Proposition en ligne, ouverte par le lien secret que l'architecte envoie à
 * son client. Pas de compte : le jeton suffit. La page montre la révision figée
 * au nom du cabinet ; la décision du client viendra avec la page client.
 */
const PRIVATE = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
};

export const headers: HeadersFunction = () => PRIVATE;

export const meta = ({ data: d }: { data?: { title?: string } }) => [
  { title: d?.title || "Proposition" },
  { name: "robots", content: "noindex, nofollow" },
];

export async function loader({ request, params }: LoaderFunctionArgs) {
  // Un aperçu de lien (messagerie) fait souvent une requête HEAD : pas de visite comptée.
  const share = await resolveShare(
    String(params.token),
    request.method === "GET",
  );
  if (share.status !== "open")
    return data(
      {
        status: share.status,
        from: "seller" in share ? share.seller?.name || null : null,
        title: "Proposition indisponible",
      },
      { status: share.status === "unknown" ? 404 : 410, headers: PRIVATE },
    );
  return data(
    {
      status: "open" as const,
      title: `${share.number} · ${share.seller?.name || "Proposition"}`,
      number: share.number,
      publishedNumber: share.publishedNumber,
      issuedAt: share.issuedAt?.toISOString() ?? null,
      expiresAt: share.expiresAt.toISOString(),
      seller: share.seller,
      state: share.state,
      pdfHref: `/d/${String(params.token)}/pdf`,
      decision: await decisionForShare(share.shareId),
    },
    { headers: PRIVATE },
  );
}

export async function action({ request, params }: ActionFunctionArgs) {
  const form = Object.fromEntries(await request.formData());
  try {
    await acceptProposal(String(params.token), form, {
      ip:
        request.headers.get("x-real-ip") ||
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        "",
      agent: request.headers.get("user-agent") || "",
    });
    return data({ ok: true as const }, { headers: PRIVATE });
  } catch (e) {
    const error =
      e instanceof ZodError
        ? e.issues[0]?.message || "Vérifiez le formulaire."
        : e instanceof Error
          ? e.message
          : "Acceptation impossible.";
    return data({ ok: false as const, error }, { status: 400, headers: PRIVATE });
  }
}

export default function SharedQuote() {
  const d = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  if (d.status !== "open")
    return (
      <main className="shared-closed">
        <h1>Proposition indisponible</h1>
        <p>
          {d.status === "expired"
            ? "Ce lien a dépassé sa date de validité."
            : d.status === "closed"
              ? "Ce lien a été remplacé ou retiré."
              : "Ce lien n'existe pas ou n'est plus valable."}{" "}
          {d.from
            ? `Demandez un nouveau lien à ${d.from}.`
            : "Demandez un nouveau lien à la personne qui vous l'a envoyé."}
        </p>
      </main>
    );
  return (
    <main className="shared-quote">
      <ClientProposal
        state={d.state}
        seller={d.seller}
        number={d.number}
        publishedNumber={d.publishedNumber}
        issuedAt={d.issuedAt}
        expiresAt={d.expiresAt}
        pdfHref={d.pdfHref}
        decision={d.decision}
        error={result && !result.ok ? result.error : undefined}
      />
    </main>
  );
}
