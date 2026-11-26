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
  assertSameOrigin,
  currentUser,
  login,
  safeNext,
} from "../services/auth.server";

export const meta = () => [{ title: "Connexion · Mikado Deco Pro" }];

export async function loader({ request }: LoaderFunctionArgs) {
  if (!isStandalone()) throw redirect("/app");
  const next = safeNext(new URL(request.url).searchParams.get("suite") || "");
  if (await currentUser(request)) throw redirect(next);
  return { next };
}

export async function action({ request }: ActionFunctionArgs) {
  if (!isStandalone()) throw redirect("/app");
  assertSameOrigin(request);
  const form = await request.formData(),
    email = String(form.get("email") || "").slice(0, 250),
    password = String(form.get("password") || "").slice(0, 200),
    next = String(form.get("next") || "");
  const response = await login(request, email, password, next);
  if (response) return response;
  // Ralentit les essais répétés sans révéler si l'e-mail existe.
  await new Promise((r) => setTimeout(r, 800));
  return { error: "E-mail ou mot de passe incorrect." };
}

export default function Connexion() {
  const { next } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  return (
    <main className="auth-page">
      <Form method="post" className="auth-card">
        <p className="auth-brand">Mikado Deco · Pro</p>
        <h1>Connexion</h1>
        <input type="hidden" name="next" value={next} />
        <label>
          E-mail
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label>
          Mot de passe
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        {result?.error && (
          <p role="alert" className="error">
            {result.error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "Connexion…" : "Se connecter"}
        </button>
        <p className="muted auth-help">
          Mot de passe oublié ? Demandez un nouveau lien à Mikado Deco.
        </p>
      </Form>
    </main>
  );
}
