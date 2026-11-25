import { createCookie } from "react-router";
import db from "../db.server";
import {
  quoteSchema,
  quoteSections,
  totals,
  upgradeQuote,
} from "../domain/quote";

// Devis ouvert en dernier : la fiche produit l'affiche à côté pour y ajouter
// une variante (dans une pièce, en alternative ou en option).
const cookie = createCookie("mikado_devis", {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 12,
});

export async function rememberQuote(id: number | null) {
  return cookie.serialize(id ?? "", id === null ? { maxAge: 0 } : undefined);
}

export async function currentQuoteId(request: Request) {
  const value = await cookie.parse(request.headers.get("Cookie"));
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Résumé du devis ouvert, s'il est encore modifiable par cette personne. */
export async function quotePanel(
  shop: string,
  id: number | null,
  owner: number | null,
) {
  if (id === null) return null;
  const q = await db.quote.findFirst({
    where: {
      id,
      shop,
      status: "draft",
      ...(owner === null ? {} : { ownerId: owner }),
      OR: [
        { conversion: null },
        { conversion: { status: { in: ["preview", "rejected"] } } },
      ],
    },
    select: { id: true, number: true, title: true, state: true },
  });
  if (!q) return null;
  const parsed = quoteSchema.safeParse(JSON.parse(q.state));
  if (!parsed.success) return null;
  const s =
    parsed.data.schemaVersion === 1 ? upgradeQuote(parsed.data) : parsed.data;
  return {
    id: q.id,
    number: q.number,
    title: q.title,
    total: totals(s).total,
    sections: quoteSections(s).map((section) => ({
      id: section.id,
      title: section.title,
      groups: section.groups.map((g) => {
        const chosen = g.items.find((i) => i.id === g.selected) || g.items[0];
        return {
          id: g.id,
          name: chosen?.name || "Produit",
          image: chosen?.image || "",
          alternatives: g.items.length - 1,
          options: s.extras.filter((e) => e.parent === g.id).length,
        };
      }),
    })),
    // Prestations hors produits ; les options sont comptées sous leur produit.
    options: s.extras.filter(
      (e) => !e.deliveryFee && !s.groups.some((g) => g.id === e.parent),
    ).length,
  };
}
