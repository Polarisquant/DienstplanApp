import { PrismaClient } from "@prisma/client";

/** In Serverless (Vercel) dieselbe Instanz über Warm-Requests wiederverwenden — weniger Verbindungen & schneller. */
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (!globalForPrisma.prisma) globalForPrisma.prisma = prisma;
