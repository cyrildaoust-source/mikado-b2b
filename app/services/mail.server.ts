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
};

export const mailEnabled = () => Boolean(process.env.RESEND_API_KEY);

export async function sendMail(mail: Mail) {
  const to = mail.to.map((t) => t.trim()).filter(Boolean);
  if (!to.length) return { sent: false as const, reason: "no-recipient" };
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
    return { sent: true as const };
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
