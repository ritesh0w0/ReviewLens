import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  getTestPrismaClient,
  disconnectTestPrismaClient,
  cleanUpTestRecords,
} from "./test-db-client.js";

describe("Real PostgreSQL: Transactions and Data Types", () => {
  const prisma = getTestPrismaClient();

  const createdDeliveryIds: string[] = [];
  const createdReviewRunIds: string[] = [];
  const createdRepoIds: string[] = [];
  const createdInstIds: string[] = [];

  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });

  afterEach(async () => {
    await cleanUpTestRecords(prisma, {
      deliveryIds: [...createdDeliveryIds],
      reviewRunIds: [...createdReviewRunIds],
      repositoryIds: [...createdRepoIds],
      installationIds: [...createdInstIds],
    });
    createdDeliveryIds.length = 0;
    createdReviewRunIds.length = 0;
    createdRepoIds.length = 0;
    createdInstIds.length = 0;
  });

  afterAll(async () => {
    await disconnectTestPrismaClient();
  });

  describe("Transaction Rollback", () => {
    it("rolls back all operations in an interactive transaction when an error occurs", async () => {
      const rollbackInstGithubId = BigInt(Date.now() + 500);

      await expect(
        prisma.$transaction(async (tx) => {
          // 1. Create installation
          const inst = await tx.installation.create({
            data: {
              githubInstallationId: rollbackInstGithubId,
              accountLogin: "rollback-test-org",
              accountType: "Organization",
            },
          });
          createdInstIds.push(inst.id);

          // 2. Intentional failure inside transaction
          throw new Error("Simulated operational failure within transaction");
        }),
      ).rejects.toThrow("Simulated operational failure within transaction");

      // Verify the installation was rolled back and does not exist in the database
      const found = await prisma.installation.findUnique({
        where: { githubInstallationId: rollbackInstGithubId },
      });
      expect(found).toBeNull();
    });

    it("rolls back batch transactions if any operation fails a database constraint", async () => {
      const batchInstGithubId = BigInt(Date.now() + 600);
      const duplicateDeliveryId = `batch-del-${Date.now()}`;
      createdDeliveryIds.push(duplicateDeliveryId);

      // Pre-create the delivery to force a unique constraint violation in the second operation
      await prisma.webhookDelivery.create({
        data: {
          deliveryId: duplicateDeliveryId,
          event: "pull_request",
          status: "RECEIVED",
        },
      });

      await expect(
        prisma.$transaction([
          prisma.installation.create({
            data: {
              githubInstallationId: batchInstGithubId,
              accountLogin: "batch-fail-org",
              accountType: "Organization",
            },
          }),
          prisma.webhookDelivery.create({
            data: {
              deliveryId: duplicateDeliveryId, // triggers P2002
              event: "pull_request",
              status: "RECEIVED",
            },
          }),
        ]),
      ).rejects.toThrow();

      // Verify the first operation was rolled back
      const found = await prisma.installation.findUnique({
        where: { githubInstallationId: batchInstGithubId },
      });
      expect(found).toBeNull();
    });
  });

  describe("Data Type Fidelity", () => {
    it("preserves BigInt values beyond Number.MAX_SAFE_INTEGER", async () => {
      // 9007199254740991 is Number.MAX_SAFE_INTEGER; test with a 64-bit integer > 2^53
      const largeGithubId = 9007199254740999n;

      const inst = await prisma.installation.create({
        data: {
          githubInstallationId: largeGithubId,
          accountLogin: "bigint-test-org",
          accountType: "User",
        },
      });
      createdInstIds.push(inst.id);

      const fetched = await prisma.installation.findUnique({
        where: { id: inst.id },
      });

      expect(fetched).not.toBeNull();
      expect(typeof fetched!.githubInstallationId).toBe("bigint");
      expect(fetched!.githubInstallationId).toBe(largeGithubId);
      expect(fetched!.githubInstallationId.toString()).toBe("9007199254740999");
    });

    it("persists and verifies valid UUID primary and foreign keys", async () => {
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

      const inst = await prisma.installation.create({
        data: {
          githubInstallationId: BigInt(Date.now() + 700),
          accountLogin: "uuid-test-org",
          accountType: "Organization",
        },
      });
      createdInstIds.push(inst.id);

      expect(inst.id).toMatch(uuidRegex);

      const repo = await prisma.repository.create({
        data: {
          installationId: inst.id,
          githubRepoId: BigInt(Date.now() + 700),
          fullName: "uuid-test-org/repo",
        },
      });
      createdRepoIds.push(repo.id);

      expect(repo.id).toMatch(uuidRegex);
      expect(repo.installationId).toBe(inst.id);
    });

    it("persists Decimal(12, 8) with exact 8-decimal precision and scale", async () => {
      const inst = await prisma.installation.create({
        data: {
          githubInstallationId: BigInt(Date.now() + 800),
          accountLogin: "decimal-test-org",
          accountType: "Organization",
        },
      });
      createdInstIds.push(inst.id);

      const repo = await prisma.repository.create({
        data: {
          installationId: inst.id,
          githubRepoId: BigInt(Date.now() + 800),
          fullName: "decimal-test-org/repo",
        },
      });
      createdRepoIds.push(repo.id);

      // Exact 8-decimal value: $0.00123456
      const cost = new Prisma.Decimal("0.00123456");

      const run = await prisma.reviewRun.create({
        data: {
          repositoryId: repo.id,
          prNumber: 999,
          headSha: "head-decimal",
          baseSha: "base-decimal",
          estCostUsd: cost,
        },
      });
      createdReviewRunIds.push(run.id);

      const fetched = await prisma.reviewRun.findUnique({
        where: { id: run.id },
      });

      expect(fetched).not.toBeNull();
      expect(fetched!.estCostUsd).not.toBeNull();
      expect(fetched!.estCostUsd!.toString()).toBe("0.00123456");
      expect(fetched!.estCostUsd!.toFixed(8)).toBe("0.00123456");
    });

    it("persists TIMESTAMPTZ(3) with millisecond fidelity", async () => {
      const targetTime = new Date("2026-11-04T12:34:56.789Z");

      const deliveryId = `test-del-timestamptz-${Date.now()}`;
      createdDeliveryIds.push(deliveryId);

      await prisma.webhookDelivery.create({
        data: {
          deliveryId,
          event: "pull_request",
          action: "opened",
          status: "RECEIVED",
          receivedAt: targetTime,
        },
      });

      const fetched = await prisma.webhookDelivery.findUnique({
        where: { deliveryId },
      });

      expect(fetched).not.toBeNull();
      expect(fetched!.receivedAt.getTime()).toBe(targetTime.getTime());
      expect(fetched!.receivedAt.toISOString()).toBe(
        "2026-11-04T12:34:56.789Z",
      );
    });
  });
});
