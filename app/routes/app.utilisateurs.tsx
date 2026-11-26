import { useState } from "react";
import {
  Form,
  useActionData,
  useLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { z } from "zod";
import db from "../db.server";
import { context, requireAdmin } from "../services/context.server";
import { createInvite, normalizeEmail } from "../services/auth.server";
import { readForm } from "../services/form.server";

export const meta = () => [{ title: "Accès · Mikado Deco Pro" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const c = await context(request);
  requireAdmin(c);
  const users = await db.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      active: true,
      lastLoginAt: true,
      passwordHash: true,
    },
  });
  return {
    users: users.map(({ passwordHash, ...u }) => ({
      ...u,
      ready: !!passwordHash,
    })),
    me: c.user?.id ?? null,
  };
}

const newUser = z.object({
  name: z.string().trim().min(1).max(150),
  email: z.string().trim().email().max(250),
  role: z.enum(["architect", "admin"]),
});

// L'adresse de la page ouverte : un lien créé sur une Preview mène à cette Preview.
function inviteUrl(request: Request, token: string) {
  return `${new URL(request.url).origin}/invitation/${token}`;
}

export async function action({ request }: ActionFunctionArgs) {
  const c = await context(request);
  requireAdmin(c);
  const form = await readForm(request),
    intent = String(form.get("intent"));
  if (intent === "create") {
    const parsed = newUser.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { error: "Vérifiez le nom et l'e-mail." };
    const email = normalizeEmail(parsed.data.email);
    if (await db.user.findUnique({ where: { email } }))
      return { error: "Cet e-mail a déjà un accès." };
    const user = await db.user.create({
      data: { name: parsed.data.name, email, role: parsed.data.role },
    });
    return {
      ok: `Accès créé pour ${user.name}.`,
      link: inviteUrl(request, await createInvite(user.id)),
    };
  }
  const id = Number(form.get("id"));
  const user = Number.isSafeInteger(id)
    ? await db.user.findUnique({ where: { id } })
    : null;
  if (!user) return { error: "Accès introuvable." };
  if (intent === "invite")
    return {
      ok: `Nouveau lien pour ${user.name}.`,
      link: inviteUrl(request, await createInvite(user.id)),
    };
  if (intent === "toggle") {
    if (user.id === c.user?.id)
      return { error: "Vous ne pouvez pas retirer votre propre accès." };
    await db.user.update({
      where: { id },
      data: { active: !user.active },
    });
    return {
      ok: user.active
        ? `Accès retiré à ${user.name}. Ses devis sont conservés.`
        : `Accès rouvert pour ${user.name}.`,
    };
  }
  return { error: "Action inconnue." };
}

export default function Users() {
  const { users, me } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  return (
    <main className="workspace">
      <header className="list-header">
        <div>
          <h1>Accès</h1>
          <p>Les personnes qui peuvent ouvrir l'outil pro.</p>
        </div>
      </header>
      {result && "error" in result && (
        <p role="alert" className="error">
          {result.error}
        </p>
      )}
      {result && "ok" in result && (
        <div role="status" className="success">
          <p>{result.ok}</p>
          {"link" in result && result.link && (
            <>
              <p>
                Envoyez-lui ce lien vous-même (e-mail ou WhatsApp). Il sert une
                seule fois, pendant 7 jours, pour choisir son mot de passe :
              </p>
              <div className="invite-link">
                <input
                  readOnly
                  aria-label="Lien d'invitation"
                  value={result.link}
                  onFocus={(e) => e.target.select()}
                />
                <CopyButton text={result.link} />
              </div>
            </>
          )}
        </div>
      )}
      <div className="list-card">
        {users.length > 0 ? (
          <table className="quote-table user-table">
            <thead>
              <tr>
                <th>Personne</th>
                <th>Rôle</th>
                <th>État</th>
                <th>
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={u.active ? undefined : "is-off"}>
                  <td>
                    <span className="user-name">
                      {u.name}
                      {u.id === me && <span className="muted"> · vous</span>}
                    </span>
                    <small>{u.email}</small>
                  </td>
                  <td>{u.role === "admin" ? "Mikado Deco" : "Architecte"}</td>
                  <td>
                    <UserState user={u} />
                  </td>
                  <td className="row-actions">
                    {(u.active || u.id !== me) && (
                      <Form method="post">
                        <input type="hidden" name="id" value={u.id} />
                        {u.active && (
                          <button name="intent" value="invite">
                            Nouveau lien
                          </button>
                        )}
                        {u.id !== me && (
                          <button name="intent" value="toggle">
                            {u.active ? "Retirer l'accès" : "Rouvrir l'accès"}
                          </button>
                        )}
                      </Form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">
            <h2>Aucun accès pour l'instant</h2>
            <p>Ajoutez une première personne ci-dessous.</p>
          </div>
        )}
      </div>
      <div className="list-card">
        <Form method="post" className="user-form">
          <h2>Ajouter un accès</h2>
          <label>
            Nom
            <input name="name" required maxLength={150} autoComplete="off" />
          </label>
          <label>
            E-mail
            <input
              name="email"
              type="email"
              required
              maxLength={250}
              autoComplete="off"
            />
          </label>
          <label>
            Rôle
            <select
              name="role"
              defaultValue="architect"
              aria-describedby="role-help"
            >
              <option value="architect">Architecte</option>
              <option value="admin">Mikado Deco</option>
            </select>
          </label>
          <button className="primary" name="intent" value="create">
            Créer l'accès
          </button>
          <p id="role-help" className="user-form-help">
            Un architecte voit ses propres devis, sans prix d'achat. Mikado
            Deco voit tout et règle l'outil. Un lien d'invitation est créé, à
            envoyer vous-même.
          </p>
        </Form>
      </div>
    </main>
  );
}

function UserState({
  user,
}: {
  user: { active: boolean; ready: boolean; lastLoginAt: string | Date | null };
}) {
  if (!user.active) return <s-badge tone="critical">Accès retiré</s-badge>;
  if (!user.ready) return <s-badge>Invitation en attente</s-badge>;
  return (
    <s-badge tone="success">
      {user.lastLoginAt
        ? `Connecté le ${new Date(user.lastLoginAt).toLocaleDateString("fr-BE")}`
        : "Prêt"}
    </s-badge>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 2500);
        } catch {
          setDone(false);
        }
      }}
    >
      {done ? "Lien copié" : "Copier le lien"}
    </button>
  );
}
