import { useEffect, useState } from "react";
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
import db from "../db.server";
import { context, requireAdmin } from "../services/context.server";
import { readForm } from "../services/form.server";
import {
  dismissRequest,
  inviteFromRequest,
  referralAdmin,
  referralOverview,
  ReferralRefused,
  setReferrer,
  type Filleul,
} from "../services/referral.server";
import {
  REFERRAL_MONTHS,
  REFERRAL_RATE,
  STAGES,
  simulate,
  stageIndex,
} from "../domain/referral";
import { firstName } from "../domain/dashboard";
import { money } from "../domain/quote";

export const meta = () => [{ title: "Parrainage · Mikado Deco Pro" }];

const origin = (request: Request) => new URL(request.url).origin;

/** Une architecte voit sa page ; Mikado Deco voit les demandes et tous les parrains,
 * ou la page d'une architecte avec ?compte=. */
export async function loader({ request }: LoaderFunctionArgs) {
  const c = await context(request);
  if (c.embedded || !c.user) throw redirect("/app");
  const admin = c.user.role === "admin";
  const asked = Number(new URL(request.url).searchParams.get("compte"));
  if (!admin || (Number.isInteger(asked) && asked > 0)) {
    const id = admin ? asked : c.user.id;
    const u = await db.user.findUnique({
      where: { id },
      select: { id: true, name: true, role: true },
    });
    if (!u || (admin && u.role === "admin"))
      throw new Response("Architecte introuvable", { status: 404 });
    const overview = await referralOverview(c.shop, u.id);
    return {
      kind: "architect" as const,
      link: `${origin(request)}/parrainage/${overview.code}`,
      who: admin ? { id: u.id, name: u.name } : null,
      first: firstName(u.name),
      ...overview,
    };
  }
  return { kind: "admin" as const, ...(await referralAdmin(c.shop)) };
}

export async function action({ request }: ActionFunctionArgs) {
  const c = await context(request);
  if (c.embedded || !c.user) throw redirect("/app");
  requireAdmin(c);
  const form = await readForm(request);
  const intent = String(form.get("intent"));
  const id = Number(form.get("id"));
  try {
    if (intent === "invite") {
      const { user, token } = await inviteFromRequest(id);
      return {
        ok: `Accès créé pour ${user.name}, relié à son parrain.`,
        link: `${origin(request)}/invitation/${token}`,
      };
    }
    if (intent === "dismiss") {
      await dismissRequest(id);
      return { ok: "Demande écartée." };
    }
    if (intent === "link") {
      const user = Number(form.get("user"));
      const raw = String(form.get("referrer") || "");
      if (!Number.isSafeInteger(user)) return { error: "Choisissez un compte." };
      await setReferrer(user, raw ? Number(raw) : null);
      return { ok: raw ? "Parrain enregistré." : "Parrain retiré." };
    }
  } catch (e) {
    if (e instanceof ReferralRefused) return { error: e.message };
    throw e;
  }
  return { error: "Action inconnue." };
}

const TZ = "Europe/Brussels";
const date = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-BE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: TZ,
  });

export default function Referral() {
  const data = useLoaderData<typeof loader>();
  return data.kind === "admin" ? <AdminView data={data} /> : <ArchitectView data={data} />;
}

type ArchitectData = Extract<
  ReturnType<typeof useLoaderData<typeof loader>>,
  { kind: "architect" }
>;

function ArchitectView({ data }: { data: ArchitectData }) {
  const count = data.filleuls.length;
  return (
    <main className="workspace ref-page">
      <header className="list-header">
        <div>
          {data.who && (
            <p className="ref-eyebrow">
              <Link to="/app/parrainage">Parrainage</Link> · page de {data.who.name}
            </p>
          )}
          <h1>Parrainage</h1>
          <p>
            Faites découvrir Mikado Deco aux cabinets avec qui vous travaillez.
            Vous touchez {REFERRAL_RATE} % de leurs commandes pendant{" "}
            {REFERRAL_MONTHS} mois.
          </p>
        </div>
      </header>

      <section className="ref-hero" aria-label="Votre lien et vos commissions">
        <div className="ref-hero-share">
          <h2>Votre lien personnel</h2>
          <p className="ref-hero-text">
            Le cabinet qui l'ouvre demande son accès. Dès que Mikado Deco
            l'accepte, il devient votre filleul.
          </p>
          <ShareLink link={data.link} first={data.first} />
        </div>
        <dl className="ref-hero-stats">
          <div className="ref-stat ref-stat-main">
            <dt>Commission acquise</dt>
            <dd>{money(data.earned)}</dd>
          </div>
          <div className="ref-stat">
            <dt>À venir</dt>
            <dd>{money(data.pending)}</dd>
          </div>
          <div className="ref-stat">
            <dt>{count > 1 ? "Filleuls" : "Filleul"}</dt>
            <dd>{count}</dd>
          </div>
        </dl>
      </section>

      <ol className="ref-steps" aria-label="Comment ça marche">
        <li>
          <span className="ref-step-n">1</span>
          <strong>Partagez votre lien</strong>
          <span>Par e-mail, WhatsApp ou de vive voix, à un confrère ou une consœur.</span>
        </li>
        <li>
          <span className="ref-step-n">2</span>
          <strong>Le cabinet rejoint l'outil</strong>
          <span>
            Il demande son accès, Mikado Deco l'ouvre. Il a ses prix pro dès le
            premier jour.
          </span>
        </li>
        <li>
          <span className="ref-step-n">3</span>
          <strong>Vous touchez {REFERRAL_RATE} %</strong>
          <span>
            Sur la marchandise HTVA de chaque devis qu'il signe pendant{" "}
            {REFERRAL_MONTHS} mois. À venir à la signature, acquise à la
            facture.
          </span>
        </li>
      </ol>

      <section className="list-card ref-list" aria-labelledby="ref-list-title">
        <div className="ref-section-head">
          <h2 id="ref-list-title">Vos filleuls</h2>
          {count > 0 && (
            <span className="muted">
              {count} {count > 1 ? "cabinets" : "cabinet"}
            </span>
          )}
        </div>
        {count ? (
          <ul className="ref-filleuls">
            {data.filleuls.map((f) => (
              <FilleulRow key={f.key} f={f} />
            ))}
          </ul>
        ) : (
          <div className="empty-state ref-empty">
            <p>
              <strong>Pas encore de filleul.</strong>
            </p>
            <p className="muted">
              Pensez aux cabinets avec qui vous partagez des chantiers : votre
              lien leur ouvre le catalogue et vos prix pro en deux minutes.
            </p>
          </div>
        )}
      </section>

      <Simulator />
    </main>
  );
}

/** Le lien, et les façons de l'envoyer. */
function ShareLink({ link, first }: { link: string; first: string }) {
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(typeof navigator.share === "function"), []);
  const message = `Bonjour, je travaille avec Mikado Deco pour mes projets : un catalogue de plus de 50 marques, des prix pro et des devis à notre nom. Voici mon lien pour demander ton accès : ${link}`;
  const subject = `${first ? `${first} t'invite` : "Invitation"} sur Mikado Deco Pro`;
  return (
    <div className="ref-share">
      <div className="ref-link">
        <input
          readOnly
          aria-label="Votre lien de parrainage"
          value={link}
          onFocus={(e) => e.target.select()}
        />
        <button
          type="button"
          className="primary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 2500);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Lien copié" : "Copier le lien"}
        </button>
      </div>
      <div className="ref-share-buttons">
        <a
          className="button"
          href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`}
        >
          Envoyer par e-mail
        </a>
        <a
          className="button"
          href={`https://wa.me/?text=${encodeURIComponent(message)}`}
          target="_blank"
          rel="noreferrer"
        >
          WhatsApp
        </a>
        {canShare && (
          <button
            type="button"
            onClick={() =>
              navigator.share({ title: subject, text: message }).catch(() => {})
            }
          >
            Partager…
          </button>
        )}
      </div>
    </div>
  );
}

function FilleulRow({ f }: { f: Filleul }) {
  const at = stageIndex(f.stage);
  const total = f.earned + f.pending;
  return (
    <li className="ref-filleul">
      <div className="ref-filleul-who">
        <span className="ref-avatar" aria-hidden="true">
          {(f.firm || f.name).slice(0, 1).toUpperCase()}
        </span>
        <div>
          <strong>{f.firm || f.name}</strong>
          <span className="muted">
            {f.firm ? `${f.name} · ` : ""}
            {f.stage === "request" ? "demande du" : "depuis le"} {date(f.since)}
          </span>
        </div>
      </div>
      <ol className="ref-track" aria-label={`Étape : ${STAGES[at].label}`}>
        {STAGES.map((s, i) => (
          <li
            key={s.key}
            className={i < at ? "done" : i === at ? "now" : ""}
            aria-current={i === at ? "step" : undefined}
          >
            <span>{s.label}</span>
          </li>
        ))}
      </ol>
      <div className="ref-filleul-gain">
        {total > 0 ? (
          <>
            <strong>{money(total)}</strong>
            <span className="muted">
              {f.pending > 0 && f.earned > 0
                ? `dont ${money(f.pending)} à venir`
                : f.pending > 0
                  ? "à venir"
                  : "acquise"}
            </span>
          </>
        ) : (
          <span className="muted">
            {f.until
              ? `${REFERRAL_RATE} % jusqu'au ${date(f.until)}`
              : "en attente de Mikado Deco"}
          </span>
        )}
      </div>
    </li>
  );
}

const euros = (cents: number) =>
  new Intl.NumberFormat("fr-BE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(cents / 100);

const VOLUMES = [20000, 50000, 100000, 200000];

/** « Et si… » : ce que rapporteraient n cabinets sur un an. */
function Simulator() {
  const [n, setN] = useState(3);
  const [volume, setVolume] = useState(50000);
  const gain = simulate(n, volume * 100);
  return (
    <section className="ref-sim" aria-labelledby="ref-sim-title">
      <div className="ref-sim-controls">
        <h2 id="ref-sim-title">Et si vous parrainiez…</h2>
        <label className="ref-sim-range">
          <span>
            <strong>{n}</strong> {n > 1 ? "cabinets" : "cabinet"}
          </span>
          <input
            type="range"
            min={1}
            max={10}
            value={n}
            onChange={(e) => setN(Number(e.target.value))}
            aria-label="Nombre de cabinets parrainés"
          />
        </label>
        <div className="ref-sim-volumes" role="group" aria-label="Commandes par cabinet et par an">
          <span className="muted">Commandes par cabinet et par an, HTVA</span>
          <div className="price-switch">
            {VOLUMES.map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={volume === v}
                onClick={() => setVolume(v)}
              >
                {v / 1000} k€
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="ref-sim-result" aria-live="polite">
        <div className="ref-sim-dots" aria-hidden="true">
          {Array.from({ length: 10 }, (_, i) => (
            <span key={i} className={i < n ? "on" : ""} />
          ))}
        </div>
        <p className="ref-sim-amount">{euros(gain)}</p>
        <p className="muted">
          de commission sur un an, sans rien changer à votre façon de
          travailler. Exemple indicatif : {REFERRAL_RATE} % de{" "}
          {euros(n * volume * 100)} de commandes HTVA.
        </p>
      </div>
    </section>
  );
}

type AdminData = Extract<
  ReturnType<typeof useLoaderData<typeof loader>>,
  { kind: "admin" }
>;

function AdminView({ data }: { data: AdminData }) {
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  const totalEarned = data.groups.reduce((n, g) => n + g.earned, 0);
  const totalPending = data.groups.reduce((n, g) => n + g.pending, 0);
  return (
    <main className="workspace ref-page">
      <header className="list-header">
        <div>
          <h1>Parrainage</h1>
          <p>
            Les demandes d'accès laissées sur les liens des architectes, et les
            commissions de {REFERRAL_RATE} % sur les commandes de leurs
            filleuls ({REFERRAL_MONTHS} mois).
          </p>
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
                Envoyez-lui ce lien vous-même. Il sert une seule fois, pendant
                7 jours, pour choisir son mot de passe :
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

      <dl className="ref-admin-stats">
        <div className="ref-stat">
          <dt>Demandes à traiter</dt>
          <dd>{data.requests.length}</dd>
        </div>
        <div className="ref-stat">
          <dt>Commissions à venir</dt>
          <dd>{money(totalPending)}</dd>
        </div>
        <div className="ref-stat">
          <dt>Commissions acquises</dt>
          <dd>{money(totalEarned)}</dd>
        </div>
      </dl>

      <section className="list-card" aria-labelledby="ref-req-title">
        <div className="ref-section-head">
          <h2 id="ref-req-title">Demandes d'accès</h2>
        </div>
        {data.requests.length ? (
          <ul className="ref-requests">
            {data.requests.map((r) => (
              <li key={r.id} className="ref-request">
                <div className="ref-request-who">
                  <strong>
                    {r.name}
                    {r.firm ? ` · ${r.firm}` : ""}
                  </strong>
                  <span className="muted">
                    <a href={`mailto:${r.email}`}>{r.email}</a>
                    {r.phone ? ` · ${r.phone}` : ""} · le {date(r.createdAt)}
                  </span>
                  <span className="ref-request-from">
                    Parrain : {r.referrer.name}
                  </span>
                  {r.message && <p className="ref-request-msg">{r.message}</p>}
                </div>
                <div className="ref-request-actions">
                  <Form method="post">
                    <input type="hidden" name="id" value={r.id} />
                    <button
                      name="intent"
                      value="invite"
                      className="primary"
                      disabled={busy}
                    >
                      Créer l'accès
                    </button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="id" value={r.id} />
                    <button
                      name="intent"
                      value="dismiss"
                      className="text-button"
                      disabled={busy}
                    >
                      Écarter
                    </button>
                  </Form>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-state ref-empty">
            <p className="muted">Aucune demande en attente.</p>
          </div>
        )}
      </section>

      <section className="list-card" aria-labelledby="ref-groups-title">
        <div className="ref-section-head">
          <h2 id="ref-groups-title">Parrains et filleuls</h2>
        </div>
        {data.groups.length ? (
          <div className="ref-groups">
            {data.groups.map((g) => (
              <div key={g.id} className="ref-group">
                <div className="ref-group-head">
                  <strong>{g.name}</strong>
                  <span className="muted">
                    {money(g.earned)} acquis · {money(g.pending)} à venir
                  </span>
                  <Link to={`?compte=${g.id}`} className="text-button">
                    Voir sa page
                  </Link>
                </div>
                <ul className="ref-filleuls">
                  {g.filleuls.map((f) => (
                    <FilleulRow key={f.key} f={f} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state ref-empty">
            <p className="muted">
              Pas encore de parrainage. Chaque architecte trouve son lien dans
              « Parrainage ».
            </p>
          </div>
        )}
      </section>

      <section className="list-card ref-link-form" aria-labelledby="ref-link-title">
        <div className="ref-section-head">
          <h2 id="ref-link-title">Relier un compte existant</h2>
        </div>
        <p className="muted">
          Pour un cabinet arrivé par une architecte sans passer par son lien.
          La période de {REFERRAL_MONTHS} mois part de l'ouverture du compte.
        </p>
        <Form method="post" className="ref-link-row">
          <input type="hidden" name="intent" value="link" />
          <label>
            Filleul
            <select name="user" required defaultValue="">
              <option value="" disabled>
                Choisir…
              </option>
              {data.architects.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Parrain
            <select name="referrer" defaultValue="">
              <option value="">Aucun</option>
              {data.architects.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <button disabled={busy}>Enregistrer</button>
        </Form>
      </section>
    </main>
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
