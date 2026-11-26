import db from "../db.server";
import { firmMissing, getFirm, getLogo } from "./firm.server";

import type { Seller } from "../domain/seller";
export type { Seller };

export function sellerSnapshot(): Seller {
  return {
    name: process.env.SELLER_NAME || "Mikado Deco",
    address: process.env.SELLER_ADDRESS || "Rue du Doyenné 75",
    email: process.env.SELLER_EMAIL || "shop@mikadodeco.be",
    website: process.env.SELLER_WEBSITE || "www.mikadodeco.be",
    vat: process.env.SELLER_VAT || "",
    kind: "mikado",
    template: "b2b-v3",
  };
}

/**
 * Émetteur d'un devis au moment où on le fige. Le devis d'un architecte est émis
 * au nom de son cabinet, jamais au nom de Mikado Deco : sans nom, adresse et TVA,
 * la révision est refusée.
 */
export async function documentSeller(ownerId: number | null): Promise<Seller> {
  if (!ownerId) return sellerSnapshot();
  const owner = await db.user.findUnique({
    where: { id: ownerId },
    select: { role: true },
  });
  if (owner?.role !== "architect") return sellerSnapshot();
  const firm = await getFirm(ownerId);
  const missing = firmMissing(firm);
  if (missing.length)
    throw Error(
      `Complétez « Mon cabinet » avant de préparer le PDF : ${missing.join(", ")}.`,
    );
  const logo = firm.hasLogo ? await getLogo(ownerId) : null;
  return {
    name: firm.name,
    address: firm.address,
    email: firm.email,
    website: firm.website,
    vat: firm.vat,
    phone: firm.phone,
    logo: logo
      ? `data:${logo.mime};base64,${Buffer.from(logo.data).toString("base64")}`
      : undefined,
    kind: "firm",
    template: "b2b-v3",
  };
}
