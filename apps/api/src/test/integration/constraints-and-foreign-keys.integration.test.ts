import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  getTestPrismaClient,
  disconnectTestPrismaClient,
  cleanUpTestRecords,
} from "./test-db-client.js";

describe("Real PostgreSQL: Constraints and Foreign Keys", () => {
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

  it("enforces primary key / unique constraint on webhook_deliveries.delivery_id (P2002)", async () => {
    const deliveryId = `test-del-uniq-${Date.now()}`;
    createdDeliveryIds.push(deliveryId);

    // First insert succeeds
    await prisma.webhookDelivery.create({
      data: {
        deliveryId,
        event: "pull_request",
        action: "opened",
        status: "RECEIVED",
      },
    });

    // Second insert with exact same deliveryId must fail with P2002
    await expect(
      prisma.webhookDelivery.create({
        data: {
          deliveryId,
          event: "pull_request",
          action: "opened",
          status: "RECEIVED",
        },
      }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "P2002",
      }),
    );
  });

  it("enforces composite unique constraint on review_runs (repository_id, pr_number, head_sha, base_sha) (P2002)", async () => {
    const inst = await prisma.installation.create({
      data: {
        githubInstallationId: BigInt(Date.now()),
        accountLogin: "test-org-uniq",
        accountType: "Organization",
      },
    });
    createdInstIds.push(inst.id);

    const repo = await prisma.repository.create({
      data: {
        installationId: inst.id,
        githubRepoId: BigInt(Date.now()),
        fullName: "test-org-uniq/test-repo",
      },
    });
    createdRepoIds.push(repo.id);

    const prNumber = 101;
    const headSha = "0123456789abcdef0123456789abcdef01234567";
    const baseSha = "abcdef0123456789abcdef0123456789abcdef01";

    const run1 = await prisma.reviewRun.create({
      data: {
        repositoryId: repo.id,
        prNumber,
        headSha,
        baseSha,
        status: "QUEUED",
      },
    });
    createdReviewRunIds.push(run1.id);

    // Duplicate (repo, pr, head, base) must throw P2002
    await expect(
      prisma.reviewRun.create({
        data: {
          repositoryId: repo.id,
          prNumber,
          headSha,
          baseSha,
          status: "QUEUED",
        },
      }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "P2002",
      }),
    );
  });

  it("enforces onDelete: Restrict from Installation to Repository (P2003)", async () => {
    const inst = await prisma.installation.create({
      data: {
        githubInstallationId: BigInt(Date.now() + 10),
        accountLogin: "test-org-restrict-inst",
        accountType: "Organization",
      },
    });
    createdInstIds.push(inst.id);

    const repo = await prisma.repository.create({
      data: {
        installationId: inst.id,
        githubRepoId: BigInt(Date.now() + 10),
        fullName: "test-org-restrict-inst/repo",
      },
    });
    createdRepoIds.push(repo.id);

    // Attempting to delete installation while repository references it must fail
    await expect(
      prisma.installation.delete({
        where: { id: inst.id },
      }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "P2003",
      }),
    );
  });

  it("enforces onDelete: Restrict from Repository to ReviewRun (P2003)", async () => {
    const inst = await prisma.installation.create({
      data: {
        githubInstallationId: BigInt(Date.now() + 20),
        accountLogin: "test-org-restrict-repo",
        accountType: "Organization",
      },
    });
    createdInstIds.push(inst.id);

    const repo = await prisma.repository.create({
      data: {
        installationId: inst.id,
        githubRepoId: BigInt(Date.now() + 20),
        fullName: "test-org-restrict-repo/repo",
      },
    });
    createdRepoIds.push(repo.id);

    const run = await prisma.reviewRun.create({
      data: {
        repositoryId: repo.id,
        prNumber: 202,
        headSha: "head202",
        baseSha: "base202",
      },
    });
    createdReviewRunIds.push(run.id);

    // Attempting to delete repository while review_run references it must fail
    await expect(
      prisma.repository.delete({
        where: { id: repo.id },
      }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "P2003",
      }),
    );
  });

  it("enforces onDelete: SetNull from ReviewRun to WebhookDelivery", async () => {
    const inst = await prisma.installation.create({
      data: {
        githubInstallationId: BigInt(Date.now() + 30),
        accountLogin: "test-org-setnull",
        accountType: "Organization",
      },
    });
    createdInstIds.push(inst.id);

    const repo = await prisma.repository.create({
      data: {
        installationId: inst.id,
        githubRepoId: BigInt(Date.now() + 30),
        fullName: "test-org-setnull/repo",
      },
    });
    createdRepoIds.push(repo.id);

    const run = await prisma.reviewRun.create({
      data: {
        repositoryId: repo.id,
        prNumber: 303,
        headSha: "head303",
        baseSha: "base303",
      },
    });
    // We don't add run.id to createdReviewRunIds because we will delete it explicitly in this test

    const deliveryId = `test-del-setnull-${Date.now()}`;
    createdDeliveryIds.push(deliveryId);

    const delivery = await prisma.webhookDelivery.create({
      data: {
        deliveryId,
        event: "pull_request",
        action: "opened",
        status: "ENQUEUED",
        reviewRunId: run.id,
      },
    });

    expect(delivery.reviewRunId).toBe(run.id);

    // Delete the ReviewRun
    await prisma.reviewRun.delete({
      where: { id: run.id },
    });

    // Refetch the WebhookDelivery: reviewRunId must now be null (onDelete: SetNull)
    const refetched = await prisma.webhookDelivery.findUnique({
      where: { deliveryId },
    });

    expect(refetched).not.toBeNull();
    expect(refetched?.reviewRunId).toBeNull();
  });
});
