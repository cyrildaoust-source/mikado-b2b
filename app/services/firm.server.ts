import { z } from "zod";
import db from "../db.server";

/** Fiche du cabinet : l'identité que verra le client sur la proposition. */
export const firmSchema = z.object({
  name: z.string().trim().max(150),
  address: z.string().trim().max(500),
  vat: z
    .string()
    .trim()
    .max(20)
    .transform((v) => v.toUpperCase().replace(/[\s.]/g, "")),
  phone: z.string().trim().max(40),
  email: z.union([z.literal(""), z.string().trim().email().max(250)]),
  website: z.string().trim().max(250),
});
export type Firm = z.infer<typeof firmSchema> & {
  hasLogo: boolean;
  version: number;
};

export const LOGO_MAX = 1_000_000;

const empty = { name: "", address: "", vat: "", phone: "", email: "", website: "" };

export async function getFirm(userId: number): Promise<Firm> {
  const f = await db.firmProfile.findUnique({
    where: { userId },
    select: {
      name: true,
      address: true,
      vat: true,
      phone: true,
      email: true,
      website: true,
      logoMime: true,
      updatedAt: true,
    },
  });
  if (!f) return { ...empty, hasLogo: false, version: 0 };
  const { logoMime, updatedAt, ...rest } = f;
  return { ...rest, hasLogo: !!logoMime, version: updatedAt.getTime() };
}

/** Champs manquants pour qu'une proposition puisse porter le nom du cabinet. */
export function firmMissing(f: Pick<Firm, "name" | "address" | "vat">) {
  const out: string[] = [];
  if (!f.name) out.push("le nom du cabinet");
  if (!f.address) out.push("l'adresse");
  if (!f.vat) out.push("le numéro de TVA");
  return out;
}

export async function saveFirm(userId: number, raw: unknown) {
  const data = firmSchema.parse(raw);
  await db.firmProfile.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}

export async function saveLogo(userId: number, file: File | null) {
  if (!file) {
    await db.firmProfile.updateMany({
      where: { userId },
      data: { logo: null, logoMime: null },
    });
    return;
  }
  if (file.size > LOGO_MAX) throw Error("Logo de 1 Mo au plus.");
  const logo = Buffer.from(await file.arrayBuffer());
  // Le type vient du contenu, pas du nom ni de ce que déclare le navigateur.
  const logoMime = sniffImage(logo);
  if (!logoMime) throw Error("Logo en PNG, JPEG ou WebP.");
  await db.firmProfile.upsert({
    where: { userId },
    create: { userId, logo, logoMime },
    update: { logo, logoMime },
  });
}

export function sniffImage(b: Uint8Array): string | null {
  const at = (i: number, bytes: number[]) =>
    bytes.every((x, k) => b[i + k] === x);
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (at(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50]))
    return "image/webp";
  return null;
}

export async function getLogo(userId: number) {
  const f = await db.firmProfile.findUnique({
    where: { userId },
    select: { logo: true, logoMime: true },
  });
  return f?.logo && f.logoMime ? { data: f.logo, mime: f.logoMime } : null;
}
