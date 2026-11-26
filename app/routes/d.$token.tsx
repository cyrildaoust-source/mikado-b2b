import {
  data,
  useLoaderData,
  type HeadersFunction,
  type LoaderFunctionArgs,
} from "react-router";
import { QuoteDocument } from "../components/QuoteDocument";
import { resolveShare } from "../services/share.server";

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
    },
    { headers: PRIVATE },
  );
}

export default function SharedQuote() {
  const d = useLoaderData<typeof loader>();
  if (d.status !== "open")
    return (
      <main className="workspace shared-quote shared-closed">
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
    <main className="workspace shared-quote">
      <p className="shared-validity">
        Proposition valable jusqu'au{" "}
        {new Date(d.expiresAt).toLocaleDateString("fr-BE", {
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: "Europe/Brussels",
        })}
        . Les prix sont garantis jusqu'à cette date.
      </p>
      <div className="shared-paper">
        <QuoteDocument
          state={d.state}
          number={d.number}
          version={d.publishedNumber}
          issuedAt={d.issuedAt}
          seller={d.seller ?? undefined}
        />
      </div>
    </main>
  );
}
