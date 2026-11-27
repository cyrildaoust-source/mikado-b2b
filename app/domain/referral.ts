// Parrainage entre architectes (Cyril, 27/11/2026).
//
// Une architecte partage son lien personnel. Le cabinet qui l'ouvre laisse une
// demande d'accès ; Mikado Deco crée l'accès, et le nouveau compte (le
// filleul) reste relié à sa marraine ou son parrain.
//
// Commission : 2 % de la marchandise HTVA facturée au filleul (prix pro, hors
// livraison et prestations), sur chaque devis contresigné pendant les
// 12 mois qui suivent son arrivée. Contresignée, elle est « à venir » ;
// facturée par Mikado Deco, elle est « acquise ». La page l'affiche : le
// versement se règle à part, comme la remise de classe.

export const REFERRAL_RATE = 2;
export const REFERRAL_MONTHS = 12;

/** Code du lien : 8 caractères sans ambiguïté (ni 0/o, ni 1/l/i). */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export function makeReferralCode(random: (n: number) => Uint8Array) {
  return [...random(8)].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}
export const isReferralCode = (s: string) => /^[a-z2-9]{8}$/.test(s);

/** Fin de la période de commission d'un filleul. */
export function referralEnd(referredAt: Date) {
  const end = new Date(referredAt);
  end.setMonth(end.getMonth() + REFERRAL_MONTHS);
  return end;
}

export const commissionOf = (cents: number) =>
  Math.round((cents * REFERRAL_RATE) / 100);

/** Une vente du filleul : un devis contresigné (signed) ou facturé (invoiced). */
export type ReferralSale = {
  quoteId: number;
  signedAt: Date;
  status: string;
  /** Marchandise HTVA facturée au filleul, en centimes. */
  merchandise: number;
};

export type CommissionLine = ReferralSale & {
  commission: number;
  state: "pending" | "earned";
};

/** Ventes qui ouvrent une commission : dans la période, contresignées ou facturées. */
export function commissionLines(
  sales: ReferralSale[],
  referredAt: Date | null,
): CommissionLine[] {
  if (!referredAt) return [];
  const end = referralEnd(referredAt);
  return sales
    .filter(
      (s) =>
        (s.status === "signed" || s.status === "invoiced") &&
        s.signedAt >= referredAt &&
        s.signedAt < end &&
        s.merchandise > 0,
    )
    .sort((a, b) => b.signedAt.getTime() - a.signedAt.getTime())
    .map((s) => ({
      ...s,
      commission: commissionOf(s.merchandise),
      state: s.status === "invoiced" ? "earned" : "pending",
    }));
}

/** Étapes du filleul, de la demande à la première commission. */
export const STAGES = [
  { key: "request", label: "Demande reçue" },
  { key: "invited", label: "Accès créé" },
  { key: "active", label: "Compte ouvert" },
  { key: "selling", label: "Premier devis signé" },
] as const;
export type Stage = (typeof STAGES)[number]["key"];

export function stageOf(f: {
  hasAccount: boolean;
  ready: boolean;
  sales: number;
}): Stage {
  if (!f.hasAccount) return "request";
  if (!f.ready) return "invited";
  return f.sales > 0 ? "selling" : "active";
}

export const stageIndex = (s: Stage) => STAGES.findIndex((x) => x.key === s);

export type Totals = { earned: number; pending: number; volume: number };
export function totalsOf(lines: CommissionLine[]): Totals {
  return lines.reduce(
    (t, l) => ({
      earned: t.earned + (l.state === "earned" ? l.commission : 0),
      pending: t.pending + (l.state === "pending" ? l.commission : 0),
      volume: t.volume + l.merchandise,
    }),
    { earned: 0, pending: 0, volume: 0 },
  );
}

/** Simulateur : commission sur un an pour n cabinets à tel chiffre annuel HTVA (centimes). */
export const simulate = (cabinets: number, yearly: number) =>
  commissionOf(Math.max(0, cabinets) * Math.max(0, yearly));
