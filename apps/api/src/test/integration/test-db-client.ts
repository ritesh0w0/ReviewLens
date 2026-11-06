import { PrismaClient } from "../../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { validateAndApplyTestDbEnvironment } from "./test-db-guard.js";

let testPrismaInstance: PrismaClient | undefined;

export function getTestPrismaClient(): PrismaClient {
  if (!testPrismaInstance) {
    validateAndApplyTestDbEnvironment();

    const connectionString =
      process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error(
        "DATABASE_URL_TEST or DATABASE_URL must be set for integration tests",
      );
    }

    const pool = new pg.Pool({
      connectionString,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      connectionTimeoutMillis: Number(
        process.env.DATABASE_CONNECT_TIMEOUT_MS ?? 5000,
      ),
      idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS ?? 10000),
    });

    pool.on("error", (err) => {
      console.error("Unexpected error on idle pg test client pool", err);
    });

    const adapter = new PrismaPg(pool, { disposeExternalPool: true });

    testPrismaInstance = new PrismaClient({
      adapter,
      log: ["error"],
    });
  }
  return testPrismaInstance;
}

export async function disconnectTestPrismaClient(): Promise<void> {
  if (testPrismaInstance) {
    await testPrismaInstance.$disconnect();
    testPrismaInstance = undefined;
  }
}

export async function cleanUpTestRecords(
  prisma: PrismaClient,
  identifiers: {
    deliveryIds?: string[];
    reviewRunIds?: string[];
    repositoryIds?: string[];
    installationIds?: string[];
  },
): Promise<void> {
  if (identifiers.deliveryIds && identifiers.deliveryIds.length > 0) {
    await prisma.webhookDelivery.deleteMany({
      where: { deliveryId: { in: identifiers.deliveryIds } },
    });
  }
  if (identifiers.reviewRunIds && identifiers.reviewRunIds.length > 0) {
    await prisma.reviewRun.deleteMany({
      where: { id: { in: identifiers.reviewRunIds } },
    });
  }
  if (identifiers.repositoryIds && identifiers.repositoryIds.length > 0) {
    await prisma.repository.deleteMany({
      where: { id: { in: identifiers.repositoryIds } },
    });
  }
  if (identifiers.installationIds && identifiers.installationIds.length > 0) {
    await prisma.installation.deleteMany({
      where: { id: { in: identifiers.installationIds } },
    });
  }
}
