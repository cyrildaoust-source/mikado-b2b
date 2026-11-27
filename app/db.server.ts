import { PrismaClient } from "@prisma/client";

// Neon fournit DATABASE_URL ; une autre base Vercel peut ne fournir que POSTGRES_URL.
process.env.DATABASE_URL ||= process.env.POSTGRES_URL;
// Préversion : la base de test (préfixe PREVIEW), jamais celle de production.
if (process.env.VERCEL_ENV === "preview") {
  if (!process.env.PREVIEW_URL)
    throw Error("Préversion sans base de test : reliez la base PREVIEW.");
  process.env.DATABASE_URL = process.env.PREVIEW_URL;
  process.env.DATABASE_URL_UNPOOLED = process.env.PREVIEW_URL_UNPOOLED || process.env.PREVIEW_URL;
}

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient;
}

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient();
  }
}

const prisma = global.prismaGlobal ?? new PrismaClient();

export default prisma;
