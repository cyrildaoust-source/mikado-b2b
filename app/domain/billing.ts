import {
  fiscalTotals,
  lineTotal,
  selectedLines,
  type QuoteState,
} from "./quote";

export const billingKinds = [
  "deposit",
  "before_delivery",
  "after_delivery",
  "balance",
] as const;

export type BillingKind = (typeof billingKinds)[number];

export type BillingMilestone = {
  kind: BillingKind;
  label: string;
  invoiceLabel: string;
  percent: number;
  amount: number;
  net: number;
  tax: number;
  requiresDeliveryConfirmation: boolean;
};

const definitions = (state: QuoteState) => {
  if (state.payment === "installments")
    return [
      {
        kind: "deposit" as const,
        label: "Acompte à la commande · 30 %",
        invoiceLabel: "Acompte de 30 % à la commande",
        percent: 30,
        requiresDeliveryConfirmation: false,
      },
      {
        kind: "before_delivery" as const,
        label: "Avant livraison · 50 %",
        invoiceLabel: "Acompte de 50 % avant livraison",
        percent: 50,
        requiresDeliveryConfirmation: false,
      },
      {
        kind: "after_delivery" as const,
        label: "Après livraison · 20 %",
        invoiceLabel: "Solde de 20 % après livraison",
        percent: 20,
        requiresDeliveryConfirmation: true,
      },
    ];
  if (state.depositPercent !== null && state.depositPercent > 0) {
    const percent = Math.min(100, state.depositPercent);
    return [
      {
        kind: "deposit" as const,
        label:
          percent === 100
            ? "Paiement intégral à la commande"
            : `Acompte à la commande · ${percent} %`,
        invoiceLabel:
          percent === 100
            ? "Paiement intégral à la commande"
            : `Acompte de ${percent} % à la commande`,
        percent,
        requiresDeliveryConfirmation: false,
      },
      ...(percent < 100
        ? [
            {
              kind: "balance" as const,
              label: `Solde avant livraison · ${100 - percent} %`,
              invoiceLabel: "Solde avant livraison",
              percent: 100 - percent,
              requiresDeliveryConfirmation: false,
            },
          ]
        : []),
    ];
  }
  return [];
};

/**
 * Allocate HTVA, TVA and TVAC by milestone. The final milestone absorbs the
 * residual cents so all milestones reconcile exactly with the quote.
 */
export function billingMilestones(state: QuoteState): BillingMilestone[] {
  const totals = fiscalTotals(state);
  if (!totals.complete || state.taxPolicy !== "BE21")
    throw Error("Vérifiez les prix et la TVA avant de préparer la facturation.");
  const defs = definitions(state);
  if (!defs.length) return [];
  const gross = defs.map((definition, index) =>
    index === defs.length - 1
      ? 0
      : Math.round((totals.gross * definition.percent) / 100),
  );
  gross[gross.length - 1] =
    totals.gross - gross.slice(0, -1).reduce((sum, value) => sum + value, 0);
  const net = defs.map((definition, index) =>
    index === defs.length - 1
      ? 0
      : Math.round((totals.net * definition.percent) / 100),
  );
  net[net.length - 1] =
    totals.net - net.slice(0, -1).reduce((sum, value) => sum + value, 0);
  return defs.map((definition, index) => {
    return {
      ...definition,
      amount: gross[index],
      net: net[index],
      tax: gross[index] - net[index],
    };
  });
}

export type BillingInvoiceLine = { name: string; net: number; tax: number };

const taxAt21 = (net: number) => Math.round(net * 0.21);

function allocateNet(weights: number[], total: number) {
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  let used = 0;
  return weights.map((weight, index) => {
    const value =
      index === weights.length - 1
        ? total - used
        : Math.round((total * weight) / weightTotal);
    used += value;
    return value;
  });
}

function tuneTax(values: number[], target: number) {
  const currentTax = () => values.reduce((sum, value) => sum + taxAt21(value), 0);
  for (let attempt = 0; attempt < 100; attempt++) {
    const before = currentTax();
    if (before === target) return true;
    let best: { from: number; to: number; amount: number; distance: number } | null =
      null;
    for (let from = 0; from < values.length; from++) {
      if (values[from] <= 0) continue;
      for (let to = 0; to < values.length; to++) {
        if (to === from) continue;
        for (let amount = 1; amount <= Math.min(100, values[from]); amount++) {
          values[from] -= amount;
          values[to] += amount;
          const distance = Math.abs(target - currentTax());
          values[from] += amount;
          values[to] -= amount;
          if (
            distance < Math.abs(target - before) &&
            (!best || distance < best.distance)
          ) {
            best = { from, to, amount, distance };
            if (distance === 0) break;
          }
        }
      }
    }
    if (!best) return false;
    values[best.from] -= best.amount;
    values[best.to] += best.amount;
  }
  return false;
}

/** Build only taxable commercial lines; no separate rounding line is allowed. */
export function billingInvoiceLines(
  state: QuoteState,
  milestone: BillingMilestone,
): BillingInvoiceLine[] {
  const source = selectedLines(state)
    .map((line) => ({ name: line.name, weight: lineTotal(line) }))
    .filter((line) => line.weight > 0);
  if (!source.length) throw Error("Aucune ligne commerciale à facturer.");
  for (let segmentCount = source.length; segmentCount <= 16; segmentCount++) {
    const segments = source.map((line) => ({ ...line }));
    while (segments.length < segmentCount) {
      const index = segments.reduce(
        (largest, line, candidate) =>
          line.weight > segments[largest].weight ? candidate : largest,
        0,
      );
      const original = segments[index];
      const first = Math.ceil(original.weight / 2);
      segments.splice(
        index,
        1,
        { name: original.name, weight: first },
        { name: original.name, weight: original.weight - first },
      );
    }
    const values = allocateNet(
      segments.map((segment) => segment.weight),
      milestone.net,
    );
    if (!tuneTax(values, milestone.tax)) continue;
    const lines = segments
      .map((segment, index) => ({
        name: `${milestone.invoiceLabel} — ${segment.name}`,
        net: values[index],
        tax: taxAt21(values[index]),
      }))
      .filter((line) => line.net > 0);
    if (
      lines.reduce((sum, line) => sum + line.net, 0) === milestone.net &&
      lines.reduce((sum, line) => sum + line.tax, 0) === milestone.tax
    )
      return lines;
  }
  throw Error(
    "La ventilation exacte HTVA/TVA est impossible sans ligne d’arrondi. Vérifiez ce devis avant facturation.",
  );
}

export function billingKindLabel(kind: string) {
  return (
    {
      deposit: "Acompte",
      before_delivery: "Avant livraison",
      after_delivery: "Après livraison",
      balance: "Solde",
    }[kind] || kind
  );
}
