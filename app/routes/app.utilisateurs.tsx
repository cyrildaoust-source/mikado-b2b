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
import { acceptedHistory, listClasses } from "../services/classes.server";
import { loyaltyStatus, percent } from "../domain/dashboard";
import { money } from "../domain/quote";

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
      classId: true,
      createdAt: true,
    },
  });
  const now = new Date();
  const [classes, history] = await Promise.all([
    listClasses(),
    acceptedHistory(c.shop, null, now),
  ]);
  return {
    users: users.map(({ passwordHash, createdAt, ...u }) => {
      const status = loyaltyStatus(
        classes,
        u.classId,
        history.get(u.id) || [],
        createdAt,
        now,
      );
      return {
        ...u,
        ready: !!passwordHash,
        volume: status.volume,
        current: status.current,
        guarantee: status.guarantee,
      };
    }),
    classes,
    me: c.user?.id ?? null,
  };
}

const newUser = z.object({
  name: z.string().trim().min(1).max(150),
  email: z.string().trim().email().max(250),
  // Case « équipe Mikado Deco » : cochée, l'accès règle l'outil ; sinon architecte.
  team: z.literal("1").optional(),
});

// L'adresse de la page ouverte : un lien créé sur une Preview mène à cette Preview.
function inviteUrl(request: Request, token: string) {
  return `${new URL(request.url).origin}/invitation/${token}`;
}

const classInput = z.object({
  name: z.string().trim().min(1).max(60),
  // Saisie belge : « 12,5 » comme « 12.5 ».
  discount: z.coerce.number().min(0).max(100),
  threshold: z.coerce.number().min(0).max(100000000),
});
function readClass(form: FormData) {
  const raw = (k: string) =>
    String(form.get(k) ?? "")
      .replace(/\s/g, "")
      .replace(",", ".");
  return classInput.safeParse({
    name: form.get("name"),
    discount: raw("discount"),
    threshold: raw("threshold") || "0",
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const c = await context(request);
  requireAdmin(c);
  const form = await readForm(request),
    intent = String(form.get("intent"));
  if (intent === "class-create" || intent === "class-update") {
    const parsed = readClass(form);
    if (!parsed.success)
      return { error: "Vérifiez le nom, la remise (0 à 100 %) et le palier." };
    const data = {
      name: parsed.data.name,
      discount: parsed.data.discount,
      threshold: Math.round(parsed.data.threshold * 100),
    };
    if (intent === "class-create") {
      await db.architectClass.create({ data });
      return { ok: `Classe ${data.name} créée.` };
    }
    const id = Number(form.get("id"));
    if (!Number.isSafeInteger(id)) return { error: "Classe introuvable." };
    const done = await db.architectClass.updateMany({ where: { id }, data });
    return done.count
      ? { ok: `Classe ${data.name} enregistrée.` }
      : { error: "Classe introuvable." };
  }
  if (intent === "class-delete") {
    const id = Number(form.get("id"));
    if (!Number.isSafeInteger(id)) return { error: "Classe introuvable." };
    const done = await db.architectClass.deleteMany({ where: { id } });
    return done.count
      ? {
          ok: "Classe supprimée. Ses architectes suivent maintenant leur chiffre.",
        }
      : { error: "Classe introuvable." };
  }
  if (intent === "user-class") {
    const id = Number(form.get("id")),
      raw = String(form.get("classId") || ""),
      classId = raw ? Number(raw) : null;
    if (
      !Number.isSafeInteger(id) ||
      (classId !== null &&
        !(await db.architectClass.findUnique({ where: { id: classId } })))
    )
      return { error: "Classe ou accès introuvable." };
    const done = await db.user.updateMany({ where: { id }, data: { classId } });
    return done.count
      ? { ok: "Classe enregistrée." }
      : { error: "Accès introuvable." };
  }
  if (intent === "create") {
    const parsed = newUser.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { error: "Vérifiez le nom et l'e-mail." };
    const email = normalizeEmail(parsed.data.email);
    if (await db.user.findUnique({ where: { email } }))
      return { error: "Cet e-mail a déjà un accès." };
    const user = await db.user.create({
      data: {
        name: parsed.data.name,
        email,
        role: parsed.data.team ? "admin" : "architect",
      },
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
  const { users, me, classes } = useLoaderData<typeof loader>();
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
          <h2>Ajouter un architecte</h2>
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
          <label className="check-row">
            <input type="checkbox" name="team" value="1" />
            C'est un membre de l'équipe Mikado Deco (voit tous les devis et règle
            l'outil)
          </label>
          <button className="primary" name="intent" value="create">
            Créer l'accès
          </button>
          <p className="user-form-help">
            L'architecte voit ses propres devis et démarre au palier ouvert dès
            l'inscription (chiffre 0 €). Un lien d'invitation est créé, à lui
            envoyer vous-même.
          </p>
        </Form>
      </div>
      <Classes
        classes={classes}
        architects={users.filter((u) => u.role !== "admin" && u.active)}
      />
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

type ClassRow = {
  id: number;
  name: string;
  discount: number;
  threshold: number;
};

/** Classes d'architectes et classe de chacun. */
const shortDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-BE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

function Classes({
  classes,
  architects,
}: {
  classes: ClassRow[];
  architects: {
    id: number;
    name: string;
    classId: number | null;
    volume: number;
    current: ClassRow | null;
    guarantee: { until: string; keep: number; soon: boolean } | null;
  }[];
}) {
  const euros = (c: number) => String(Math.round(c / 100));
  return (
    <>
      <section className="list-card class-card" aria-labelledby="classes-title">
        <div className="class-head">
          <h2 id="classes-title">Classes et remises</h2>
          <p>
            Chaque architecte voit sa remise et la suivante sur son accueil. Sa
            classe est la plus haute entre celle choisie plus bas et celle que
            son chiffre ouvre : devis acceptés HTVA sur les 12 derniers mois.
          </p>
        </div>
        <table className="class-table">
          <thead>
            <tr>
              <th>Classe</th>
              <th>Remise (%)</th>
              <th>Palier, € HTVA sur 12 mois</th>
              <th>
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {classes.map((k) => (
              <tr key={k.id}>
                <td data-label="Classe">
                  <input
                    form={`class-${k.id}`}
                    name="name"
                    defaultValue={k.name}
                    required
                    maxLength={60}
                    aria-label="Nom de la classe"
                  />
                </td>
                <td data-label="Remise (%)">
                  <input
                    form={`class-${k.id}`}
                    name="discount"
                    defaultValue={String(k.discount).replace(".", ",")}
                    inputMode="decimal"
                    required
                    aria-label="Remise en pour cent"
                  />
                </td>
                <td data-label="Palier, € HTVA sur 12 mois">
                  <input
                    form={`class-${k.id}`}
                    name="threshold"
                    defaultValue={euros(k.threshold)}
                    inputMode="numeric"
                    aria-label="Palier en euros HTVA"
                  />
                </td>
                <td className="row-actions">
                  <Form method="post" id={`class-${k.id}`}>
                    <input type="hidden" name="id" value={k.id} />
                    <button name="intent" value="class-update">
                      Enregistrer
                    </button>
                    <button
                      name="intent"
                      value="class-delete"
                      className="text-button"
                    >
                      Supprimer
                    </button>
                  </Form>
                </td>
              </tr>
            ))}
            <tr className="class-new" key={`new-${classes.length}`}>
              <td data-label="Nouvelle classe">
                <input
                  form="class-new"
                  name="name"
                  required
                  maxLength={60}
                  placeholder={
                    classes.length ? "Nouvelle classe" : "Ex. Bronze"
                  }
                  aria-label="Nom de la nouvelle classe"
                />
              </td>
              <td data-label="Remise (%)">
                <input
                  form="class-new"
                  name="discount"
                  inputMode="decimal"
                  required
                  placeholder="Ex. 5"
                  aria-label="Remise de la nouvelle classe, en pour cent"
                />
              </td>
              <td data-label="Palier, € HTVA sur 12 mois">
                <input
                  form="class-new"
                  name="threshold"
                  inputMode="numeric"
                  placeholder="0 = dès l'inscription"
                  aria-label="Palier de la nouvelle classe, en euros HTVA"
                />
              </td>
              <td className="row-actions">
                <Form method="post" id="class-new">
                  <button
                    className="primary"
                    name="intent"
                    value="class-create"
                  >
                    Ajouter
                  </button>
                </Form>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
      {classes.length > 0 && architects.length > 0 && (
        <section className="list-card class-card" aria-labelledby="class-users">
          <div className="class-head">
            <h2 id="class-users">Classe des architectes</h2>
          </div>
          <table className="class-table">
            <thead>
              <tr>
                <th>Architecte</th>
                <th>Chiffre 12 mois</th>
                <th>Classe choisie</th>
                <th>Remise actuelle</th>
              </tr>
            </thead>
            <tbody>
              {architects.map((u) => (
                <tr key={u.id}>
                  <td data-label="Architecte">{u.name}</td>
                  <td data-label="Chiffre 12 mois">{money(u.volume)} HTVA</td>
                  <td data-label="Classe choisie">
                    <Form method="post" className="class-pick">
                      <input type="hidden" name="id" value={u.id} />
                      <input type="hidden" name="intent" value="user-class" />
                      <select
                        name="classId"
                        defaultValue={u.classId ?? ""}
                        aria-label={`Classe de ${u.name}`}
                        onChange={(e) => e.currentTarget.form?.requestSubmit()}
                      >
                        <option value="">Selon le chiffre</option>
                        {classes.map((k) => (
                          <option key={k.id} value={k.id}>
                            {k.name} au minimum
                          </option>
                        ))}
                      </select>
                      <noscript>
                        <button>Enregistrer</button>
                      </noscript>
                    </Form>
                  </td>
                  <td data-label="Remise actuelle">
                    {u.current ? (
                      <s-badge tone="success">
                        {u.current.name} · {percent(u.current.discount)}
                      </s-badge>
                    ) : (
                      <span className="muted">Aucune</span>
                    )}
                    {u.guarantee && (
                      <small className="class-guarantee">
                        Garantie jusqu'au {shortDate(u.guarantee.until)}
                      </small>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
