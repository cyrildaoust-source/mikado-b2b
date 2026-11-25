import { z } from "zod";
const text = z.string().max(4000);
const cent = z.number().int().min(0).max(1000000000000);
export const addressSchema = z.object({
  address1: text.default(""),
  address2: text.default(""),
  city: text.default(""),
  zip: text.default(""),
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .default("BE"),
  company: text.default(""),
  firstName: text.default(""),
  lastName: text.default(""),
});
export const lineSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1, "La désignation est obligatoire.").max(250),
  sku: z.string().max(150).default(""),
  detail: z.string().max(100000).default(""),
  variantId: z
    .string()
    .regex(/^gid:\/\/shopify\/ProductVariant\/\d+$/)
    .nullable()
    .default(null),
  image: z.string().max(2000).default(""),
  qty: z.number().int().min(1).max(10000),
  price: z.number().int().min(0).max(100000000),
  discount: z.number().min(0).max(100),
  taxable: z.boolean().default(true),
  requiresShipping: z.boolean().default(true),
  vatRate: z.number().min(0).max(100).nullable().default(null),
  priceConfirmed: z.boolean().default(true),
  sourcePrice: cent.nullable().default(null),
  sourceIncludesTax: z.boolean().default(false),
  deliveryFee: z.boolean().optional(),
  chargePercent: z.number().min(0).max(100).nullable().default(null),
  sourceVatRate: z.number().min(0).max(100).nullable().default(null),
});
export const quoteSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]).default(1),
    taxPolicy: z.enum(["historical", "BE21"]).default("historical"),
    payment: z
      .enum([
        "legacy",
        "unspecified",
        "cash",
        "deposit",
        "installments",
        "full",
        "custom",
      ])
      .default("legacy"),
    project: z.string().min(1, "Le projet est obligatoire.").max(150),
    client: z.string().max(150),
    contact: z.string().max(150),
    email: z.union([z.literal(""), z.string().email()]),
    customerId: z
      .string()
      .regex(/^gid:\/\/shopify\/Customer\/\d+$/)
      .nullable(),
    customerVat: z.string().max(100).default(""),
    // Fiche client : prénom, nom, société facultative (client et contact en découlent).
    firstName: z.string().max(150).default(""),
    lastName: z.string().max(150).default(""),
    company: z.string().max(150).default(""),
    shipping: addressSchema,
    billing: addressSchema,
    billingSame: z.boolean(),
    // Version client : le PDF montre les prix publics, sans les remises de l'architecte.
    hideDiscounts: z.boolean().default(false),
    validity: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    terms: text,
    depositPercent: z.number().min(0).max(100).nullable().default(null),
    delivery: text,
    note: text,
    currency: z.literal("EUR"),
    taxesIncluded: z.boolean(),
    groups: z
      .array(
        z.object({
          id: z.string().min(1).max(100),
          section: z.string().max(150),
          sectionId: z.string().max(100).default(""),
          selected: z.string(),
          syncQty: z.boolean().default(true),
          items: z.array(lineSchema).min(1).max(20),
        }),
      )
      .max(200),
    extras: z.array(lineSchema.extend({ selected: z.boolean() })).max(100),
  })
  .superRefine((s, ctx) => {
    if (
      s.taxPolicy === "BE21" &&
      [...s.groups.flatMap((g) => g.items), ...s.extras].some(
        (l) => !l.taxable || l.vatRate !== 21,
      )
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Ce devis utilise une TVA de 21 %. Vérifiez les articles incompatibles avec ce régime.",
      });
    if (s.payment === "deposit" && s.depositPercent === null)
      ctx.addIssue({
        code: "custom",
        message: "Indiquez le pourcentage de l’acompte.",
      });
    const ids = new Set<string>(),
      groups = new Set<string>();
    for (const g of s.groups) {
      if (groups.has(g.id))
        ctx.addIssue({
          code: "custom",
          message: "Identifiant de groupe dupliqué.",
        });
      groups.add(g.id);
      if (!g.items.some((i) => i.id === g.selected))
        ctx.addIssue({
          code: "custom",
          message: "Une sélection est manquante.",
        });
      if (
        s.schemaVersion === 2 &&
        g.syncQty &&
        g.items.some((i) => i.qty !== g.items[0].qty)
      )
        ctx.addIssue({
          code: "custom",
          message: "Les quantités liées doivent être identiques.",
        });
      for (const i of g.items) {
        if (ids.has(i.id))
          ctx.addIssue({
            code: "custom",
            message: "Identifiant de ligne dupliqué.",
          });
        ids.add(i.id);
      }
    }
    for (const e of s.extras) {
      if (ids.has(e.id))
        ctx.addIssue({
          code: "custom",
          message: "Identifiant de ligne dupliqué.",
        });
      ids.add(e.id);
    }
    if (ids.size > 499)
      ctx.addIssue({
        code: "custom",
        message: "Maximum 499 propositions par devis.",
      });
    if (s.schemaVersion === 2 && s.taxesIncluded)
      ctx.addIssue({
        code: "custom",
        message: "Les nouveaux devis doivent être saisis HTVA.",
      });
    if (
      !Number.isFinite(Date.parse(s.validity)) ||
      new Date(s.validity).toISOString().slice(0, 10) !== s.validity
    )
      ctx.addIssue({ code: "custom", message: "Date de validité incorrecte." });
  })
  .transform((s) => {
    const base = s.groups.reduce(
      (n, g) => n + lineTotal(g.items.find((i) => i.id === g.selected)!),
      0,
    );
    return {
      ...s,
      terms: paymentText(s.payment, s.depositPercent, s.terms),
      depositPercent:
        s.payment === "full"
          ? 100
          : s.payment === "installments"
            ? 30
            : ["cash", "unspecified"].includes(s.payment)
              ? null
              : s.depositPercent,
      extras: s.extras.map((e) =>
        e.chargePercent === null
          ? e
          : {
              ...e,
              name: e.deliveryFee ? "Livraison + montage" : e.name,
              variantId: null,
              qty: 1,
              discount: 0,
              price: Math.round((base * e.chargePercent) / 100),
              priceConfirmed: true,
            },
      ),
    };
  });

export type QuoteState = z.infer<typeof quoteSchema>;
export type Line = z.infer<typeof lineSchema>;
export const lineTotal = (l: Line) =>
  Math.round((l.price * l.qty * (100 - l.discount)) / 100);
export const lineTax = (l: Line) => {
  if (!l.taxable || l.vatRate === null) return 0;
  return Math.round((lineTotal(l) * l.vatRate) / 100);
};
export function selectedLines(s: QuoteState) {
  return [
    ...s.groups.map((g) => g.items.find((i) => i.id === g.selected)!),
    ...s.extras.filter((e) => e.selected),
  ];
}
export function totals(s: QuoteState) {
  const base = s.groups.reduce((n, g) => n + lineTotal(g.items[0]), 0),
    selected = s.groups.reduce(
      (n, g) => n + lineTotal(g.items.find((i) => i.id === g.selected)!),
      0,
    ),
    extras = s.extras
      .filter((e) => e.selected)
      .reduce((n, e) => n + lineTotal(e), 0);
  return { base, delta: selected - base, extras, total: selected + extras };
}
export function costBreakdown(s: QuoteState) {
  const products = s.groups.reduce(
      (n, g) => n + lineTotal(g.items.find((i) => i.id === g.selected)!),
      0,
    ),
    delivery = s.extras
      .filter((e) => e.selected && e.deliveryFee)
      .reduce((n, e) => n + lineTotal(e), 0),
    options = s.extras
      .filter((e) => e.selected && !e.deliveryFee)
      .reduce((n, e) => n + lineTotal(e), 0);
  return { products, options, delivery, total: products + options + delivery };
}
export function fiscalTotals(s: QuoteState) {
  const lines = selectedLines(s),
    net = totals(s).total,
    complete =
      s.schemaVersion === 2 &&
      lines.length > 0 &&
      lines.every(
        (l) => l.priceConfirmed && (!l.taxable || l.vatRate !== null),
      );
  const bins = new Map<number, number>();
  for (const l of lines) {
    if (l.taxable && l.vatRate !== null)
      bins.set(
        l.vatRate,
        (bins.get(l.vatRate) || 0) + lineTax(l),
      );
  }
  const taxLines = [...bins]
    .sort(([a], [b]) => a - b)
    .map(([rate, amount]) => ({ rate, amount }));
  const tax = taxLines.reduce((n, l) => n + l.amount, 0),
    gross = net + tax,
    deposit =
      s.depositPercent === null
        ? null
        : Math.round((gross * s.depositPercent) / 100);
  return {
    complete,
    net,
    tax,
    gross,
    taxLines,
    deposit,
    balance: deposit === null ? null : gross - deposit,
  };
}
export function assertPriced(s: QuoteState) {
  if (s.schemaVersion !== 2)
    throw Error("Dupliquez cet ancien devis en version B2B avant conversion.");
  if (!fiscalTotals(s).complete)
    throw Error(
      "Vérifiez les prix HTVA et la TVA de toutes les lignes retenues.",
    );
}
export function setQuantity(
  s: QuoteState,
  id: string,
  qty: number,
): QuoteState {
  return {
    ...s,
    groups: s.groups.map((g) =>
      g.items.some((i) => i.id === id)
        ? {
            ...g,
            items: g.items.map((i) =>
              g.syncQty || i.id === id ? { ...i, qty } : i,
            ),
          }
        : g,
    ),
    extras: s.extras.map((e) => (e.id === id ? { ...e, qty } : e)),
  };
}

export function removeLine(s: QuoteState, id: string): QuoteState {
  const sectionOrder = quoteSections(s).map((section) => section.id);
  const remainingGroups = s.groups.flatMap((group) => {
    const items = group.items.filter((item) => item.id !== id);
    if (!items.length) return [];
    return [
      {
        ...group,
        items,
        selected: items.some((item) => item.id === group.selected)
          ? group.selected
          : items[0].id,
      },
    ];
  });
  const groupsBySection = new Map<string, QuoteState["groups"]>();
  for (const group of remainingGroups) {
    const sectionId = group.sectionId || `legacy:${group.section || "Produits"}`;
    const groups = groupsBySection.get(sectionId) || [];
    groups.push(group);
    groupsBySection.set(sectionId, groups);
  }
  return {
    ...s,
    groups: sectionOrder.flatMap((sectionId) =>
      groupsBySection.get(sectionId) || [],
    ),
    extras: s.extras.filter((extra) => extra.id !== id),
  };
}
export function fromGross(l: Line, rate: number): Line {
  if (l.sourcePrice === null) throw Error("Prix source absent.");
  return {
    ...l,
    price: Math.round(l.sourcePrice / (1 + rate / 100)),
    sourceVatRate: rate,
    priceConfirmed: true,
  };
}
export function upgradeQuote(s: QuoteState): QuoteState {
  const convert = (l: Line) => ({
    ...l,
    sourcePrice: l.price,
    sourceIncludesTax: s.taxesIncluded,
    price: s.taxesIncluded ? 0 : l.price,
    priceConfirmed: !s.taxesIncluded,
  });
  return quoteSchema.parse({
    ...s,
    schemaVersion: 2,
    taxesIncluded: false,
    groups: s.groups.map((g) => ({
      ...g,
      syncQty: g.items.every((i) => i.qty === g.items[0].qty),
      items: g.items.map(convert),
    })),
    extras: s.extras.map((e) => ({ ...convert(e), selected: e.selected })),
  });
}
export function cents(s: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw Error("Montant monétaire invalide");
  const [a, b = ""] = s.split(".");
  return Number(a) * 100 + Number(b.padEnd(2, "0"));
}
export const amount = (c: number) => (c / 100).toFixed(2);
export const money = (c: number) =>
  new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(
    c / 100,
  );
export const signedMoney = (c: number) => (c > 0 ? "+" : "") + money(c);
export const reference = (id: number, date: string | Date) =>
  `DEV-${new Date(date).getFullYear()}-${String(id).padStart(4, "0")}`;
export function emptyQuote(_taxesIncluded = false): QuoteState {
  return quoteSchema.parse({
    schemaVersion: 2,
    taxPolicy: "BE21",
    payment: "unspecified",
    project: "Nouveau projet",
    client: "",
    contact: "",
    email: "",
    customerId: null,
    shipping: addressSchema.parse({}),
    billing: addressSchema.parse({}),
    billingSame: true,
    validity: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    terms: "À convenir à la commande",
    depositPercent: null,
    delivery: "À confirmer",
    note: "Les alternatives non retenues sont exclues du total. Les options sont présentées séparément.",
    currency: "EUR",
    taxesIncluded: false,
    groups: [],
    extras: [],
  });
}

type ClientFields = Pick<
  QuoteState,
  "firstName" | "lastName" | "company" | "client" | "contact" | "shipping" | "billing"
>;

/** Prénom, nom, société d'un devis, retrouvés aussi sur un devis plus ancien. */
export function clientNames(s: ClientFields) {
  if (s.firstName || s.lastName || s.company)
    return { firstName: s.firstName, lastName: s.lastName, company: s.company };
  const person = s.contact || (s.client && !s.shipping.company ? s.client : "");
  const [first, ...rest] = person.trim().split(/\s+/);
  return {
    firstName: rest.length ? first : "",
    lastName: rest.length ? rest.join(" ") : first || "",
    company: s.client && s.client !== person ? s.client : s.shipping.company,
  };
}

/** Recalcule client et contact, et complète les noms des adresses restés vides. */
export function withClientNames<T extends ClientFields>(s: T): T {
  const firstName = s.firstName.trim(),
    lastName = s.lastName.trim(),
    company = s.company.trim(),
    person = [firstName, lastName].filter(Boolean).join(" ");
  const fill = (a: T["shipping"]) => ({
    ...a,
    firstName: a.firstName || firstName,
    lastName: a.lastName || lastName,
    company: a.company || company,
  });
  return {
    ...s,
    firstName,
    lastName,
    company,
    client: company || person,
    contact: person,
    shipping: fill(s.shipping),
    billing: fill(s.billing),
  };
}

/** Nouveau devis : livraison + montage déjà ajoutée au taux par défaut, à retirer au besoin. */
export function newQuote(taxesIncluded = false): QuoteState {
  return setDeliveryFee(emptyQuote(taxesIncluded), true, crypto.randomUUID());
}

export function repriceExtras(s: QuoteState): QuoteState {
  const base = s.groups.reduce(
    (n, g) => n + lineTotal(g.items.find((i) => i.id === g.selected)!),
    0,
  );
  return {
    ...s,
    extras: s.extras.map((e) =>
      e.chargePercent === null
        ? e
        : {
            ...e,
            variantId: null,
            qty: 1,
            discount: 0,
            price: Math.round((base * e.chargePercent) / 100),
            priceConfirmed: true,
          },
    ),
  };
}

/** Ce que voit le client final : sans remises si l'architecte les masque. */
export function clientView(s: QuoteState): QuoteState {
  if (!s.hideDiscounts) return s;
  const plain = <T extends { discount: number }>(l: T) => ({ ...l, discount: 0 });
  return repriceExtras({
    ...s,
    groups: s.groups.map((g) => ({ ...g, items: g.items.map(plain) })),
    extras: s.extras.map(plain),
  });
}

export function paymentText(mode: string, percent: number | null, custom = "") {
  if (mode === "deposit")
    return `Acompte de ${percent ?? 0} % à la commande, solde de ${100 - (percent ?? 0)} % avant livraison`;
  if (mode === "installments")
    return "30 % d’acompte à la commande, 50 % avant livraison et 20 % après livraison";
  if (mode === "full") return "Paiement intégral à la commande";
  if (mode === "cash") return "Paiement comptant";
  if (mode === "unspecified") return "À convenir à la commande";
  return custom;
}
export function paymentSchedule(s: QuoteState, gross: number) {
  if (s.payment === "installments") {
    const deposit = Math.round(gross * 0.3),
      beforeDelivery = Math.round(gross * 0.5);
    return [
      { label: "Acompte à la commande · 30 %", amount: deposit },
      { label: "Avant livraison · 50 %", amount: beforeDelivery },
      {
        label: "Après livraison · 20 %",
        amount: gross - deposit - beforeDelivery,
      },
    ];
  }
  if (s.depositPercent !== null) {
    const deposit = Math.round((gross * s.depositPercent) / 100);
    return [
      { label: `Acompte · ${s.depositPercent} %`, amount: deposit },
      {
        label: "Solde avant livraison",
        amount: gross - deposit,
      },
    ];
  }
  return [];
}
export function commercialStatus(q: {
  status: string;
  version: number;
  conversion?: { status: string } | null;
  revisions?: {
    version: number;
    publishedNumber: number | null;
    sentAt: unknown;
    pdfGeneratedAt?: unknown;
  }[];
}) {
  if (q.status === "deleted") return "Supprimé · corbeille";
  if (q.status === "archived") return "Archivé";
  if (q.conversion && ["creating", "uncertain"].includes(q.conversion.status))
    return "À vérifier";
  if (q.status === "converted") return "Commande créée";
  const ready = q.revisions?.find((r) => r.publishedNumber && r.pdfGeneratedAt);
  if (!ready)
    return q.revisions?.some((r) => r.publishedNumber)
      ? "PDF à préparer"
      : "Brouillon";
  if (ready.version !== q.version) return "Modifications en cours";
  return `${ready.sentAt ? "Envoyé" : "Prêt à envoyer"} · R${ready.publishedNumber}`;
}
export function applyMikadoPolicy(s: QuoteState): QuoteState {
  const previous = s.schemaVersion === 1 ? upgradeQuote(s) : s;
  const convert = (l: Line): Line => ({
    ...(!l.priceConfirmed && l.sourcePrice !== null ? fromGross(l, 21) : l),
    vatRate: 21,
    taxable: true,
  });
  return quoteSchema.parse({
    ...previous,
    taxPolicy: "BE21",
    payment:
      previous.payment === "legacy" && previous.depositPercent !== null
        ? "deposit"
        : previous.payment,
    groups: previous.groups.map((g) => ({ ...g, items: g.items.map(convert) })),
    extras: previous.extras.map((e) => ({
      ...convert(e),
      selected: e.selected,
    })),
  });
}
export function quoteSections(s: QuoteState) {
  const map = new Map<
    string,
    { id: string; title: string; groups: QuoteState["groups"] }
  >();
  for (const g of s.groups) {
    const id = g.sectionId || `legacy:${g.section || "Produits"}`;
    if (!map.has(id))
      map.set(id, { id, title: g.section || "Produits", groups: [] });
    map.get(id)!.groups.push(g);
  }
  return [...map.values()];
}

/** Taux par défaut de la ligne « Livraison + montage » (décision de Cyril, 25/11/2026). */
export const DELIVERY_PERCENT = 4;

export function setDeliveryFee(
  s: QuoteState,
  enabled: boolean,
  id: string,
  percent?: number,
): QuoteState {
  const existing = s.extras.find((e) => e.deliveryFee);
  const rate = Math.min(
    100,
    Math.max(0, percent ?? existing?.chargePercent ?? DELIVERY_PERCENT),
  );
  const extras = s.extras.filter((e) => !e.deliveryFee);
  if (enabled)
    extras.push({
      ...lineSchema.parse({
        id: existing?.id ?? id,
        name: "Livraison + montage",
        qty: 1,
        price: 0,
        discount: 0,
        chargePercent: rate,
        deliveryFee: true,
        taxable: true,
        vatRate: 21,
        requiresShipping: false,
      }),
      selected: true,
    });
  return repriceExtras({ ...s, extras });
}
