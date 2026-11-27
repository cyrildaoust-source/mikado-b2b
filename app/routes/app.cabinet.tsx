import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { useEffect, useRef } from "react";
import db from "../db.server";
import { context, type Context } from "../services/context.server";
import {
  firmMissing,
  getFirm,
  saveFirm,
  saveLogo,
} from "../services/firm.server";

export const meta = () => [{ title: "Mon cabinet · Mikado Deco Pro" }];

/**
 * Compte dont on lit la fiche : l'architecte connecté, ou pour Mikado Deco
 * l'architecte choisi dans « Accès » (?compte=).
 */
async function target(request: Request, c: Context) {
  if (c.embedded || !c.user) throw redirect("/app");
  if (c.user.role !== "admin") return { id: c.user.id, name: c.user.name, own: true };
  const id = Number(new URL(request.url).searchParams.get("compte"));
  if (!Number.isInteger(id) || id <= 0) throw redirect("/app/utilisateurs");
  const u = await db.user.findUnique({
    where: { id },
    select: { id: true, name: true, role: true },
  });
  if (!u || u.role === "admin")
    throw new Response("Architecte introuvable", { status: 404 });
  return { id: u.id, name: u.name, own: false };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const c = await context(request);
  const t = await target(request, c);
  const firm = await getFirm(t.id);
  return { firm, missing: firmMissing(firm), who: t };
}

export async function action({ request }: ActionFunctionArgs) {
  const c = await context(request);
  const t = await target(request, c);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  try {
    if (intent === "logo") {
      const file = form.get("logo");
      if (!(file instanceof File) || !file.size)
        return { error: "Choisissez un fichier." };
      await saveLogo(t.id, file);
      return { ok: "Logo enregistré." };
    }
    if (intent === "logo-remove") {
      await saveLogo(t.id, null);
      return { ok: "Logo retiré." };
    }
    await saveFirm(t.id, {
      name: form.get("name") ?? "",
      address: form.get("address") ?? "",
      vat: form.get("vat") ?? "",
      phone: form.get("phone") ?? "",
      email: form.get("email") ?? "",
      website: form.get("website") ?? "",
    });
    return { ok: "Fiche enregistrée." };
  } catch (e) {
    const message =
      e instanceof Error && !("issues" in e)
        ? e.message
        : "Vérifiez les champs, l'e-mail notamment.";
    return { error: message };
  }
}

export default function Cabinet() {
  const { firm, missing, who } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  // Le message est en haut de page : on y revient après chaque envoi.
  const feedback = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (result) feedback.current?.scrollIntoView({ block: "center" });
  }, [result]);
  const logoSrc = `/app/cabinet/logo?v=${firm.version}${who.own ? "" : `&compte=${who.id}`}`;
  return (
    <main className="workspace cabinet-page">
      {!who.own && (
        <Link className="back-link" to="/app/utilisateurs">
          ← Retour aux accès
        </Link>
      )}
      <header className="list-header">
        <div>
          <h1>{who.own ? "Mon cabinet" : `Cabinet de ${who.name}`}</h1>
          <p>
            Ces informations figurent sur les propositions envoyées à{" "}
            {who.own ? "vos" : "ses"} clients. Mikado Deco n'y apparaît pas.
          </p>
        </div>
      </header>
      {missing.length > 0 && (
        <p className="notice" role="status">
          À compléter pour partager une proposition : {missing.join(", ")}.
        </p>
      )}
      <div ref={feedback}>
      {result && "error" in result && (
        <p role="alert" className="error">
          {result.error}
        </p>
      )}
      {result && "ok" in result && (
        <p role="status" className="success">
          {result.ok}
        </p>
      )}
      </div>
      <div className="cabinet-grid">
        <Form
          method="post"
          className="list-card cabinet-form"
          key={firm.version}
        >
          <h2>Identité</h2>
          <label>
            Nom du cabinet
            <input name="name" defaultValue={firm.name} maxLength={150} />
          </label>
          <label>
            Adresse
            <textarea
              name="address"
              rows={3}
              defaultValue={firm.address}
              maxLength={500}
            />
          </label>
          <label>
            Numéro de TVA
            <input
              name="vat"
              defaultValue={firm.vat}
              maxLength={20}
              placeholder="BE0123456789"
            />
          </label>
          <div className="cabinet-row">
            <label>
              Téléphone
              <input
                name="phone"
                type="tel"
                defaultValue={firm.phone}
                maxLength={40}
              />
            </label>
            <label>
              E-mail
              <input
                name="email"
                type="email"
                defaultValue={firm.email}
                maxLength={250}
              />
            </label>
          </div>
          <label>
            Site web
            <input name="website" defaultValue={firm.website} maxLength={250} />
          </label>
          <button
            className="primary"
            name="intent"
            value="save"
            disabled={busy}
          >
            Enregistrer
          </button>
        </Form>
        <div className="list-card cabinet-logo">
          <h2>Logo</h2>
          <div className="cabinet-logo-preview">
            {firm.hasLogo ? (
              <img src={logoSrc} alt={`Logo de ${firm.name || "ce cabinet"}`} />
            ) : (
              <span className="muted">Aucun logo</span>
            )}
          </div>
          <Form method="post" encType="multipart/form-data">
            <label>
              Fichier PNG, JPEG ou WebP, 1 Mo au plus
              <input
                type="file"
                name="logo"
                accept="image/png,image/jpeg,image/webp"
                required
              />
            </label>
            <button name="intent" value="logo" disabled={busy}>
              Envoyer le logo
            </button>
          </Form>
          {firm.hasLogo && (
            <Form method="post">
              <button
                className="text-button"
                name="intent"
                value="logo-remove"
                disabled={busy}
              >
                Retirer le logo
              </button>
            </Form>
          )}
        </div>
      </div>
    </main>
  );
}
