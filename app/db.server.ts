import { PrismaClient } from "@prisma/client";

// Neon fournit DATABASE_URL ; une autre base Vercel peut ne fournir que POSTGRES_URL.
process.env.DATABASE_URL ||= process.env.POSTGRES_URL;

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
