import { PrismaClient, Prisma } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { loadFileSecrets } from "../config/secrets.js";

loadFileSecrets();

let prismaInstance: PrismaClient | undefined;

export interface PrismaClientOptions {
  connectionString?: string;
  maxConnections?: number;
}

export function createPrismaClient(
  options: PrismaClientOptions = {},
): PrismaClient {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL environment variable is required to initialize PrismaClient",
    );
  }

  const pool = new pg.Pool({
    connectionString,
    max: options.maxConnections ?? Number(process.env.DATABASE_POOL_MAX ?? 10),
    connectionTimeoutMillis: Number(
      process.env.DATABASE_CONNECT_TIMEOUT_MS ?? 5000,
    ),
    idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS ?? 30000),
  });

  pool.on("error", (err) => {
    // Prevent unhandled error events from crashing the process
    console.error("Unexpected error on idle pg client pool", err);
  });

  const adapter = new PrismaPg(pool, { disposeExternalPool: true });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export function getPrismaClient(): PrismaClient {
  if (!prismaInstance) {
    prismaInstance = createPrismaClient();
  }

  return prismaInstance;
}

export async function disconnectPrismaClient(): Promise<void> {
  if (prismaInstance) {
    await prismaInstance.$disconnect();
    prismaInstance = undefined;
  }
}

export { PrismaClient, Prisma };
export * from "../generated/prisma/client.js";
