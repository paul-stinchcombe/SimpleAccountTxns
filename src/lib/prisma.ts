import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  pgPool?: Pool;
};

function getAdapter() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to initialize Prisma.");
  }

  const pool =
    globalForPrisma.pgPool ??
    new Pool({
      connectionString,
    });

  if (!globalForPrisma.pgPool) {
    globalForPrisma.pgPool = pool;
  }

  return new PrismaPg(pool);
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: getAdapter(),
    log: process.env.NODE_ENV === "development" ? ["error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
