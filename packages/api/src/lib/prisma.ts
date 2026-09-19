import { PrismaClient } from "@prisma/client";

// Prevents multiple Prisma Client instances during dev hot-reload
declare global {
  var prismaGlobal: PrismaClient | undefined;
}

export const prisma = globalThis.prismaGlobal ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.prismaGlobal = prisma;
}