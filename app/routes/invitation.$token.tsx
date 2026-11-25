import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { isStandalone } from "../services/mode.server";
import {
  acceptInvite,
  assertSameOrigin,
  findInvite,
  startSession,
} from "../services/auth.server";

export async function loader({ params }: LoaderFunctionArgs) {
  if (!isStandalone()) throw redirect("/app");
  const invite = await findInvite(String(params.token));
  return invite
    ? { valid: true as const, name: invite.user.name, email: invite.user.email }
    : { valid: false as const };
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (!isStandalone()) throw redirect("/app");
  assertSameOrigin(request);
  const form = await request.formData(),
    password = String(form.get("password") || ""),
    confirm = String(form.get("confirm") || "");
  if (password !== confirm)
    return { error: "Les deux mots de passe ne sont pas identiques." };
  try {
    const userId = await acceptInvite(String(params.token), password);
    return startSession(request, userId, "/app/catalogue");
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Lien invalide." };
  }
}

export default function Invitation() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  return (
    <main className="auth-page">
      <div className="auth-card">
        <p className="auth-brand">Mikado Deco · Pro</p>
        {data.valid ? (
          <Form method="post">
            <h1>Bienvenue {data.name}</h1>
            <p className="muted">
              Choisissez votre mot de passe pour {data.email}.
            </p>
            <label>
              Mot de passe (10 caractères au moins)
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={10}
                required
              />
            </label>
            <label>
              Confirmer le mot de passe
              <input
                name="confirm"
                type="password"
                autoComplete="new-password"
                minLength={10}
                required
              />
            </label>
            {result?.error && (
              <p role="alert" className="error">
                {result.error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              Ouvrir mon accès
            </button>
          </Form>
        ) : (
          <>
            <h1>Lien expiré</h1>
            <p>
              Ce lien a déjà servi ou n'est plus valable. Demandez-en un nouveau
              à Mikado Deco.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
