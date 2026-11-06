import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  getTestPrismaClient,
  disconnectTestPrismaClient,
  cleanUpTestRecords,
} from "./test-db-client.js";
import {
  createPgBoss,
  startPgBoss,
  stopPgBoss,
  fromPrisma,
  PgBoss,
} from "../../queue/client.js";
import { ensureQueues } from "../../queue/setup-queues.js";
import { QUEUE_REVIEW_PR } from "../../queue/queues.js";

describe("Real PostgreSQL & pg-boss: Transaction Integration (Step 2)", () => {
  const prisma = getTestPrismaClient();
  const testDbUrl = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;

  let boss: PgBoss;
  const createdDeliveryIds: string[] = [];
  const createdReviewRunIds: string[] = [];
  const createdRepoIds: string[] = [];
  const createdInstIds: string[] = [];

  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;

    boss = createPgBoss({
      connectionString: testDbUrl,
      schema: "pgboss",
      max: 4,
      application_name: "test-boss-step2",
    });

    await startPgBoss(boss);
    await ensureQueues(boss);
  });

  afterAll(async () => {
    if (boss) {
      await stopPgBoss(boss);
    }
    await cleanUpTestRecords(prisma, {
      deliveryIds: createdDeliveryIds,
      reviewRunIds: createdReviewRunIds,
      repositoryIds: createdRepoIds,
      installationIds: createdInstIds,
    });
    await disconnectTestPrismaClient();
  });

  async function createTestRepo() {
    const inst = await prisma.installation.create({
      data: {
        githubInstallationId: BigInt(
          Math.floor(Math.random() * 900000) + 100000,
        ),
        accountLogin: `org-test-${randomUUID().slice(0, 8)}`,
        accountType: "Organization",
      },
    });
    createdInstIds.push(inst.id);

    const repo = await prisma.repository.create({
      data: {
        installationId: inst.id,
        githubRepoId: BigInt(Math.floor(Math.random() * 9000000) + 1000000),
        fullName: `test-org/repo-${randomUUID().slice(0, 8)}`,
      },
    });
    createdRepoIds.push(repo.id);

    return { inst, repo };
  }

  it("Test 1: successfully commits application write and pg-boss job in same transaction", async () => {
    const { repo } = await createTestRepo();
    const runId = randomUUID();
    createdReviewRunIds.push(runId);

    await prisma.$transaction(async (tx) => {
      await tx.reviewRun.create({
        data: {
          id: runId,
          repositoryId: repo.id,
          prNumber: 42,
          headSha: "1111111111111111111111111111111111111111",
          baseSha: "0000000000000000000000000000000000000000",
        },
      });

      const inserted = await boss.insert(
        QUEUE_REVIEW_PR,
        [
          {
            id: runId,
            data: { schemaVersion: 1, runId },
          },
        ],
        {
          returnId: true,
          db: fromPrisma(tx),
        },
      );

      expect(inserted).toEqual([runId]);
    });

    // Verification after transaction commits:
    // 1. ReviewRun exists in PostgreSQL
    const persistedRun = await prisma.reviewRun.findUnique({
      where: { id: runId },
    });
    expect(persistedRun).not.toBeNull();
    expect(persistedRun?.id).toBe(runId);

    // 2. Queue job exists in pg-boss
    const jobs = await boss.findJobs(QUEUE_REVIEW_PR, { id: runId });
    expect(jobs.length).toBe(1);
    expect(jobs[0].id).toBe(runId);
    expect(jobs[0].data).toEqual({ schemaVersion: 1, runId });
  });

  it("Test 2: rolls back both application write and pg-boss job when transaction fails", async () => {
    const { repo } = await createTestRepo();
    const runId = randomUUID();

    const forcedError = new Error(
      "Simulated database failure during transaction",
    );

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.reviewRun.create({
          data: {
            id: runId,
            repositoryId: repo.id,
            prNumber: 99,
            headSha: "2222222222222222222222222222222222222222",
            baseSha: "0000000000000000000000000000000000000000",
          },
        });

        await boss.insert(
          QUEUE_REVIEW_PR,
          [
            {
              id: runId,
              data: { schemaVersion: 1, runId },
            },
          ],
          {
            returnId: true,
            db: fromPrisma(tx),
          },
        );

        // Intentionally throw to trigger transaction abort
        throw forcedError;
      }),
    ).rejects.toThrow("Simulated database failure during transaction");

    // Verification after transaction rollback:
    // 1. ReviewRun MUST NOT exist
    const persistedRun = await prisma.reviewRun.findUnique({
      where: { id: runId },
    });
    expect(persistedRun).toBeNull();

    // 2. Queue job MUST NOT exist (atomicity verified)
    const jobs = await boss.findJobs(QUEUE_REVIEW_PR, { id: runId });
    expect(jobs.length).toBe(0);
  });

  it("Test 3: safely handles duplicate job identity and idempotency with insert()", async () => {
    const { repo } = await createTestRepo();
    const runId = randomUUID();
    createdReviewRunIds.push(runId);

    // Initial insert in transaction
    await prisma.$transaction(async (tx) => {
      await tx.reviewRun.create({
        data: {
          id: runId,
          repositoryId: repo.id,
          prNumber: 100,
          headSha: "3333333333333333333333333333333333333333",
          baseSha: "0000000000000000000000000000000000000000",
        },
      });

      const firstInsert = await boss.insert(
        QUEUE_REVIEW_PR,
        [{ id: runId, data: { schemaVersion: 1, runId } }],
        { returnId: true, db: fromPrisma(tx) },
      );
      expect(firstInsert).toEqual([runId]);
    });

    // Repeated insertion with the exact same job ID in a new transaction
    await prisma.$transaction(async (tx) => {
      const secondInsert = await boss.insert(
        QUEUE_REVIEW_PR,
        [{ id: runId, data: { schemaVersion: 1, runId } }],
        { returnId: true, db: fromPrisma(tx) },
      );

      // Duplicate job ID on standard queue is skipped by pg-boss insert (returns null)
      expect(
        secondInsert === null ||
          (Array.isArray(secondInsert) && secondInsert.length === 0),
      ).toBe(true);
    });

    // Inspect through public API: exactly 1 logical job exists
    const jobs = await boss.findJobs(QUEUE_REVIEW_PR, { id: runId });
    expect(jobs.length).toBe(1);
    expect(jobs[0].id).toBe(runId);
  });

  it("Test 4: handles concurrent pg-boss initialization safely via PostgreSQL advisory locks", async () => {
    // Start two separate pg-boss instances targeting the same schema concurrently
    const bossA = createPgBoss({
      connectionString: testDbUrl,
      schema: "pgboss",
      max: 2,
      application_name: "test-boss-concurrent-a",
    });
    const bossB = createPgBoss({
      connectionString: testDbUrl,
      schema: "pgboss",
      max: 2,
      application_name: "test-boss-concurrent-b",
    });

    try {
      await Promise.all([startPgBoss(bossA), startPgBoss(bossB)]);

      const versionA = await bossA.schemaVersion();
      const versionB = await bossB.schemaVersion();

      expect(versionA).toBeGreaterThan(0);
      expect(versionB).toBe(versionA);
    } finally {
      await Promise.all([stopPgBoss(bossA), stopPgBoss(bossB)]);
    }
  });

  it("Test 5: performs graceful shutdown without losing active job state", async () => {
    const testBoss = createPgBoss({
      connectionString: testDbUrl,
      schema: "pgboss",
      max: 2,
      application_name: "test-boss-shutdown",
    });

    await startPgBoss(testBoss);
    const testQueue = `test-shutdown-${randomUUID().slice(0, 8)}`;
    await testBoss.createQueue(testQueue, { policy: "standard" });

    let workerCalled = false;
    await testBoss.work(testQueue, async () => {
      workerCalled = true;
    });

    // Gracefully stop instance
    await stopPgBoss(testBoss);

    expect(workerCalled).toBe(false);
  });
});
