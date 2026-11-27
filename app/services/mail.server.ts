/**
 * Envoi d'e-mails par Resend (validé par Cyril le 26/11/2026). Sans clé
 * RESEND_API_KEY, rien ne part : le message est seulement journalisé, et
 * l'écran reste la source d'information (file « À facturer », bandeaux).
 */
export type Mail = {
  to: string[];
  subject: string;
  text: string;
  replyTo?: string;
  /** Clé d'idempotence Resend : un même envoi retenté ne part qu'une fois. */
  idempotencyKey?: string;
};

export type MailResult =
  | { sent: true; id: string | null }
  | { sent: false; reason: string };

/**
 * Simulation : MAIL_SIMULATE=true (préversions, essais) ou un transport posé
 * par les tests. Rien ne sort ; le message est journalisé.
 */
type Transport = (mail: Mail & { to: string[] }) => Promise<MailResult>;
let transport: Transport | null = null;
export function setMailTransport(t: Transport | null) {
  transport = t;
}
const simulated: Transport = async (mail) => {
  console.info(`[mail] simulé → ${mail.to.join(", ")} : ${mail.subject}`);
  return { sent: true, id: `simulated-${mail.idempotencyKey || Date.now()}` };
};

export const mailEnabled = () =>
  Boolean(transport) ||
  process.env.MAIL_SIMULATE === "true" ||
  Boolean(process.env.RESEND_API_KEY);

export async function sendMail(mail: Mail): Promise<MailResult> {
  const to = mail.to.map((t) => t.trim()).filter(Boolean);
  if (!to.length) return { sent: false as const, reason: "no-recipient" };
  if (transport) return transport({ ...mail, to });
  if (process.env.MAIL_SIMULATE === "true") return simulated({ ...mail, to });
  if (!mailEnabled()) {
    console.info(`[mail] non envoyé (Resend non configuré) : ${mail.subject}`);
    return { sent: false as const, reason: "disabled" };
  }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        ...(mail.idempotencyKey ? { "Idempotency-Key": mail.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: process.env.MAIL_FROM || "Mikado Deco Pro <noreply@mikadodeco.be>",
        to,
        subject: mail.subject,
        text: mail.text,
        ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) {
      console.error(`[mail] Resend ${r.status} : ${mail.subject}`);
      return { sent: false as const, reason: `http-${r.status}` };
    }
    // Envoyé seulement quand Resend l'a accepté et a rendu son identifiant.
    const body = (await r.json().catch(() => null)) as { id?: string } | null;
    return { sent: true as const, id: body?.id ?? null };
  } catch (e) {
    console.error(`[mail] échec : ${mail.subject}`, e);
    return { sent: false as const, reason: "network" };
  }
}

/** Adresse de Mikado Deco pour les alertes (décision sans contresignature…). */
export const mikadoAlertEmail = () =>
  process.env.MIKADO_ALERT_EMAIL || "shop@mikadodeco.be";

export const appUrl = () =>
  (process.env.SHOPIFY_APP_URL || "https://pro.mikadodeco.be").replace(/\/$/, "");
