import { PrismaClient } from "@prisma/client";
import { validateAndApplyTestDbEnvironment } from "./test-db-guard.js";

let testPrismaInstance: PrismaClient | undefined;

export function getTestPrismaClient(): PrismaClient {
  if (!testPrismaInstance) {
    validateAndApplyTestDbEnvironment();
    testPrismaInstance = new PrismaClient({
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
