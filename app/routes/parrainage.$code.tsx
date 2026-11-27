import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { ZodError } from "zod";
import { isStandalone } from "../services/mode.server";
import { isDemo } from "../services/context.server";
import { assertSameOrigin, clientIp } from "../services/auth.server";
import {
  createReferralRequest,
  findReferrer,
  ReferralRefused,
} from "../services/referral.server";
import { firstName } from "../domain/dashboard";
import { listClasses } from "../services/classes.server";

// Page publique du lien de parrainage : un cabinet invité par une architecte
// demande son accès. Mikado Deco crée l'accès ensuite, à la main.

export const meta = () => [
  { title: "Invitation · Mikado Deco Pro" },
  { name: "robots", content: "noindex, nofollow" },
];

function guard() {
  if (!isStandalone() && !isDemo()) throw redirect("/app");
}

export async function loader({ params }: LoaderFunctionArgs) {
  guard();
  const referrer = await findReferrer(String(params.code));
  if (!referrer) return { valid: false as const };
  // Remises de la grille en vigueur : celle de départ et la plus haute.
  const classes = await listClasses();
  const rates = classes.map((c) => c.discount);
  const start = classes.filter((c) => c.threshold === 0).map((c) => c.discount);
  return {
    valid: true as const,
    name: referrer.name,
    first: firstName(referrer.name) || referrer.name,
    firm: referrer.firm,
    discount: rates.length
      ? { from: start.length ? Math.max(...start) : null, max: Math.max(...rates) }
      : null,
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  guard();
  assertSameOrigin(request);
  const referrer = await findReferrer(String(params.code));
  if (!referrer) return { error: "Ce lien n'est plus valable." };
  const form = Object.fromEntries(await request.formData());
  // Champ piège : invisible pour une personne, rempli par un robot.
  if (form.website) return { done: true as const };
  try {
    await createReferralRequest(referrer, form, clientIp(request));
    return { done: true as const };
  } catch (e) {
    if (e instanceof ZodError)
      return { error: e.issues[0]?.message || "Vérifiez le formulaire." };
    if (e instanceof ReferralRefused) return { error: e.message };
    throw e;
  }
}

const pct = (n: number) => `${String(n).replace(".", ",")} %`;
function perks(discount: { from: number | null; max: number } | null) {
  const price = !discount
    ? "Une remise Mikado Deco sur le prix public, qui grandit avec votre volume."
    : discount.from !== null && discount.from < discount.max
      ? `Une remise de ${pct(discount.from)} dès l'ouverture du compte, puis jusqu'à ${pct(discount.max)} selon votre volume.`
      : `Une remise Mikado Deco jusqu'à ${pct(discount.max)} sur le prix public.`;
  return [
  {
    title: "Tout le catalogue",
    text: "Plus de 50 marques de mobilier, luminaires et objets, en grandes photos, avec les finitions et les modèles 3D.",
  },
  {
    title: "Vos prix pro",
    text: price,
  },
  {
    title: "Des devis à votre nom",
    text: "Devis au nom de votre cabinet, lien en ligne pour votre client, acceptation et suivi des commandes.",
  },
  ];
}

export default function ReferralLanding() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  if (!data.valid)
    return (
      <main className="auth-page">
        <div className="auth-card">
          <p className="auth-brand">Mikado Deco · Pro</p>
          <h1>Lien expiré</h1>
          <p className="muted">
            Ce lien d'invitation n'est plus valable. Demandez-en un nouveau à la
            personne qui vous l'a envoyé, ou écrivez à Mikado Deco.
          </p>
        </div>
      </main>
    );
  const who = data.firm ? `${data.name}, ${data.firm}` : data.name;
  return (
    <main className="ref-landing">
      <div className="ref-landing-inner">
        <section className="ref-landing-intro">
          <p className="auth-brand">Mikado Deco · Pro</p>
          <p className="ref-landing-from">
            <span className="ref-avatar" aria-hidden="true">
              {data.first.slice(0, 1).toUpperCase()}
            </span>
            Invitation de {who}
          </p>
          <h1>
            {data.first} vous ouvre l'outil pro de Mikado Deco
          </h1>
          <p className="ref-landing-lead">
            L'espace des architectes et architectes d'intérieur qui travaillent
            avec la boutique Mikado Deco, à Uccle.
          </p>
          <ul className="ref-perks">
            {perks(data.discount).map((p) => (
              <li key={p.title}>
                <strong>{p.title}</strong>
                <span>{p.text}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="ref-landing-card" aria-labelledby="ref-form-title">
          {result && "done" in result ? (
            <div className="ref-done" role="status">
              <span className="ref-done-mark" aria-hidden="true">
                ✓
              </span>
              <h2 id="ref-form-title">Demande envoyée</h2>
              <p>
                Mikado Deco a bien reçu votre demande et vous enverra votre lien
                d'accès par e-mail.
              </p>
            </div>
          ) : (
            <Form method="post" className="ref-form">
              <h2 id="ref-form-title">Demander mon accès</h2>
              <p className="muted">
                Gratuit, sans engagement. Mikado Deco ouvre chaque accès
                lui-même.
              </p>
              <label>
                Nom et prénom
                <input name="name" autoComplete="name" required maxLength={150} />
              </label>
              <label>
                Cabinet
                <input
                  name="firm"
                  autoComplete="organization"
                  maxLength={150}
                />
              </label>
              <label>
                E-mail professionnel
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={250}
                />
              </label>
              <label>
                Téléphone <span className="muted">(facultatif)</span>
                <input name="phone" type="tel" autoComplete="tel" maxLength={40} />
              </label>
              <label>
                Un mot sur vos projets <span className="muted">(facultatif)</span>
                <textarea name="message" rows={3} maxLength={1000} />
              </label>
              <label className="ref-trap" aria-hidden="true">
                Site web
                <input name="website" tabIndex={-1} autoComplete="off" />
              </label>
              {result && "error" in result && (
                <p role="alert" className="error">
                  {result.error}
                </p>
              )}
              <button className="primary" disabled={busy}>
                {busy ? "Envoi…" : "Demander mon accès"}
              </button>
            </Form>
          )}
        </section>
      </div>
    </main>
  );
}
