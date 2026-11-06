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
  PgBoss,
} from "../../queue/client.js";
import { ensureQueues } from "../../queue/setup-queues.js";
import { QUEUE_REVIEW_PR_DLQ } from "../../queue/queues.js";
import {
  ReviewStatus,
  InstallationStatus,
} from "../../generated/prisma/client.js";
import { processReviewJob } from "../../workers/review-processor.js";
import { FakeGitHubPullRequestClient } from "../../github/fake-client.js";
import { formatReviewMarker } from "../../github/pull-request-client.js";
import { registerDeadLetterWorker } from "../../workers/dead-letter-worker.js";

describe("Real PostgreSQL: Worker Execution, Claim Ownership & GitHub Integration (Steps 4–6)", () => {
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
      application_name: "test-boss-worker",
    });

    await startPgBoss(boss);
    await ensureQueues(boss);
    await registerDeadLetterWorker(boss, prisma);
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

  async function createTestRun(
    options: {
      prNumber?: number;
      headSha?: string;
      baseSha?: string;
      instStatus?: InstallationStatus;
      repoEnabled?: boolean;
    } = {},
  ) {
    const instGithubId = BigInt(Math.floor(Math.random() * 900000) + 100000);
    const githubRepoId = BigInt(Math.floor(Math.random() * 9000000) + 1000000);

    const inst = await prisma.installation.create({
      data: {
        githubInstallationId: instGithubId,
        accountLogin: `worker-org-${instGithubId}`,
        accountType: "Organization",
        status: options.instStatus ?? InstallationStatus.ACTIVE,
      },
    });
    createdInstIds.push(inst.id);

    const repo = await prisma.repository.create({
      data: {
        installationId: inst.id,
        githubRepoId,
        fullName: `worker-org-${instGithubId}/test-repo`,
        defaultBranch: "main",
        enabled: options.repoEnabled ?? true,
      },
    });
    createdRepoIds.push(repo.id);

    const headSha =
      options.headSha ?? "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const baseSha =
      options.baseSha ?? "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const prNumber = options.prNumber ?? 101;

    const run = await prisma.reviewRun.create({
      data: {
        repositoryId: repo.id,
        prNumber,
        headSha,
        baseSha,
        status: ReviewStatus.QUEUED,
      },
    });
    createdReviewRunIds.push(run.id);

    return { inst, repo, run, headSha, baseSha, prNumber };
  }

  it("claims ReviewRun with claimToken, publishes advisory review, and marks SUCCEEDED", async () => {
    const { run, headSha, baseSha, prNumber } = await createTestRun();

    const fakeGithub = new FakeGitHubPullRequestClient({
      prInfo: {
        state: "open",
        headSha,
        baseSha,
        prNumber,
      },
      reviews: [],
    });

    const claimToken = randomUUID();
    const result = await processReviewJob(prisma, run.id, {
      claimToken,
      attempt: 1,
      githubClient: fakeGithub,
      publishReview: true,
    });

    expect(result.status).toBe(ReviewStatus.SUCCEEDED);
    expect(result.githubReviewId).toBeDefined();

    // Verify 1 advisory review was published
    expect(fakeGithub.reviewsCreated.length).toBe(1);
    expect(fakeGithub.reviewsCreated[0].body).toContain(
      formatReviewMarker(run.id),
    );

    // Verify ReviewRun state in PostgreSQL
    const updatedRun = await prisma.reviewRun.findUnique({
      where: { id: run.id },
    });
    expect(updatedRun?.status).toBe(ReviewStatus.SUCCEEDED);
    expect(updatedRun?.githubReviewId).toBe(
      BigInt(fakeGithub.reviewsCreated[0].body ? result.githubReviewId! : 0),
    );
    expect(updatedRun?.finishedAt).not.toBeNull();
  });

  it("prevents stale worker attempt from overwriting newer claim", async () => {
    const { run, headSha, baseSha, prNumber } = await createTestRun();

    const fakeGithub = new FakeGitHubPullRequestClient({
      prInfo: { state: "open", headSha, baseSha, prNumber },
      reviews: [],
    });

    const oldClaimToken = randomUUID();
    const newClaimToken = randomUUID();

    // Step 1: Claim with oldClaimToken
    await prisma.reviewRun.update({
      where: { id: run.id },
      data: {
        status: ReviewStatus.RUNNING,
        claimToken: oldClaimToken,
        attemptCount: 1,
      },
    });

    // Step 2: A newer attempt (e.g. pg-boss retry) claims the run with newClaimToken
    await prisma.reviewRun.update({
      where: { id: run.id },
      data: {
        status: ReviewStatus.RUNNING,
        claimToken: newClaimToken,
        attemptCount: 2,
      },
    });

    // Step 3: Old attempt finishes and tries to write with oldClaimToken
    await processReviewJob(prisma, run.id, {
      claimToken: oldClaimToken,
      attempt: 1,
      githubClient: fakeGithub,
    });

    // The run must NOT have been marked SUCCEEDED with oldClaimToken because claimToken was changed!
    const runAfterStale = await prisma.reviewRun.findUnique({
      where: { id: run.id },
    });
    expect(runAfterStale?.claimToken).toBe(newClaimToken);
    expect(runAfterStale?.status).toBe(ReviewStatus.RUNNING);
  });

  it("skips review and transitions to SUPERSEDED when PR head SHA changed", async () => {
    const { run, baseSha, prNumber } = await createTestRun({
      headSha: "1111111111111111111111111111111111111111",
    });

    const newerSha = "2222222222222222222222222222222222222222";
    const fakeGithub = new FakeGitHubPullRequestClient({
      prInfo: {
        state: "open",
        headSha: newerSha, // GitHub has a newer head SHA
        baseSha,
        prNumber,
      },
      reviews: [],
    });

    const claimToken = randomUUID();
    const result = await processReviewJob(prisma, run.id, {
      claimToken,
      attempt: 1,
      githubClient: fakeGithub,
      publishReview: true,
    });

    expect(result.status).toBe(ReviewStatus.SUPERSEDED);
    expect(result.skipped).toBe(true);
    expect(fakeGithub.reviewsCreated.length).toBe(0); // Did not publish comment!

    const updated = await prisma.reviewRun.findUnique({
      where: { id: run.id },
    });
    expect(updated?.status).toBe(ReviewStatus.SUPERSEDED);
    expect(updated?.degradedReason).toContain("superseded");
  });

  it("skips review and transitions to SKIPPED when PR is closed", async () => {
    const { run, headSha, baseSha, prNumber } = await createTestRun();

    const fakeGithub = new FakeGitHubPullRequestClient({
      prInfo: {
        state: "closed",
        headSha,
        baseSha,
        prNumber,
      },
      reviews: [],
    });

    const claimToken = randomUUID();
    const result = await processReviewJob(prisma, run.id, {
      claimToken,
      attempt: 1,
      githubClient: fakeGithub,
      publishReview: true,
    });

    expect(result.status).toBe(ReviewStatus.SKIPPED);
    expect(result.skipped).toBe(true);
    expect(fakeGithub.reviewsCreated.length).toBe(0);

    const updated = await prisma.reviewRun.findUnique({
      where: { id: run.id },
    });
    expect(updated?.status).toBe(ReviewStatus.SKIPPED);
    expect(updated?.degradedReason).toContain("closed");
  });

  it("recovers already-published review and avoids duplicate GitHub comments", async () => {
    const { run, headSha, baseSha, prNumber } = await createTestRun();

    const existingReviewId = 778899;
    const fakeGithub = new FakeGitHubPullRequestClient({
      prInfo: { state: "open", headSha, baseSha, prNumber },
      reviews: [
        {
          id: existingReviewId,
          body: `Pre-existing comment\n\n${formatReviewMarker(run.id)}`,
          state: "COMMENTED",
          commit_id: headSha,
          user: { login: "reviewlens[bot]", type: "Bot", id: 12345 },
        },
      ],
    });

    const claimToken = randomUUID();
    const result = await processReviewJob(prisma, run.id, {
      claimToken,
      attempt: 2,
      githubClient: fakeGithub,
      publishReview: true,
    });

    expect(result.status).toBe(ReviewStatus.SUCCEEDED);
    expect(result.recovered).toBe(true);
    expect(Number(result.githubReviewId)).toBe(existingReviewId);

    // Must NOT have created a second review
    expect(fakeGithub.reviewsCreated.length).toBe(0);

    const updated = await prisma.reviewRun.findUnique({
      where: { id: run.id },
    });
    expect(updated?.status).toBe(ReviewStatus.SUCCEEDED);
    expect(updated?.githubReviewId).toBe(BigInt(existingReviewId));
  });

  it("marks ReviewRun FAILED when job reaches dead-letter queue", async () => {
    const { run } = await createTestRun();

    // Insert job into DLQ directly
    await boss.send(QUEUE_REVIEW_PR_DLQ, { schemaVersion: 1, runId: run.id });

    // Wait for dead-letter worker to process job
    let updated = await prisma.reviewRun.findUnique({ where: { id: run.id } });
    for (let i = 0; i < 30 && updated?.status !== ReviewStatus.FAILED; i++) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      updated = await prisma.reviewRun.findUnique({ where: { id: run.id } });
    }

    expect(updated?.status).toBe(ReviewStatus.FAILED);
    expect(updated?.failureReason).toContain("DLQ");
  });
});
