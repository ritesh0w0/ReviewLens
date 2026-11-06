import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  InstallationStatus,
  ReviewStatus,
} from "../generated/prisma/client.js";
import { processReviewJob } from "../workers/review-processor.js";
import { FakeGitHubPullRequestClient } from "../github/fake-client.js";
import { formatReviewMarker } from "../github/pull-request-client.js";
import { createMockPrismaClient } from "./mock-prisma.js";
import { PullRequestDiffPipeline } from "../pipeline/pull-request-diff-pipeline.js";

describe("Marker Reconciliation & Idempotent Review Recovery (M3 Step 5)", () => {
  const headSha = "1111111111111111111111111111111111111111";
  const baseSha = "2222222222222222222222222222222222222222";
  const prNumber = 101;

  async function setupRun(prisma: ReturnType<typeof createMockPrismaClient>) {
    const inst = await prisma.installation.upsert({
      where: { githubInstallationId: 9999n },
      create: {
        githubInstallationId: 9999n,
        accountLogin: "test-org",
        accountType: "Organization",
        status: InstallationStatus.ACTIVE,
      },
      update: {},
    });

    const repo = await prisma.repository.upsert({
      where: { githubRepoId: 8888n },
      create: {
        githubRepoId: 8888n,
        fullName: "test-org/test-repo",
        enabled: true,
        installationId: inst.id,
      },
      update: {},
    });

    const runId = `run-${randomUUID()}`;
    const claimToken = randomUUID();

    const run = await prisma.reviewRun.create({
      data: {
        id: runId,
        repositoryId: repo.id,
        prNumber,
        headSha,
        baseSha,
        status: ReviewStatus.RUNNING,
        claimToken,
        attemptCount: 1,
      },
    });

    return { run, claimToken, repo, inst };
  }

  it("reconciles existing valid App marker before M2 without running M2 preparation", async () => {
    const prisma = createMockPrismaClient();
    const { run, claimToken } = await setupRun(prisma);
    const marker = formatReviewMarker(run.id);

    // Existing review created earlier
    const existingReview = {
      id: 777111,
      body: `Previous review advisory comment\n\n${marker}`,
      state: "COMMENTED",
      commit_id: headSha,
      user: { login: "reviewlens[bot]", type: "Bot", id: 12345 },
    };

    const fakeGithub = new FakeGitHubPullRequestClient({
      prInfo: {
        state: "open",
        headSha,
        baseSha,
        prNumber,
        changedFilesCount: 1,
      },
      reviews: [existingReview],
    });

    // Spy on M2 prepare to ensure it is NEVER called when review is recovered!
    let m2PrepareCalled = false;
    const mockPipeline = {
      prepare: async () => {
        m2PrepareCalled = true;
        throw new Error(
          "M2 prepare should not be called when marker is recovered!",
        );
      },
    } as unknown as PullRequestDiffPipeline;

    const result = await processReviewJob(prisma, run.id, {
      claimToken,
      attempt: 1,
      githubClient: fakeGithub,
      pipeline: mockPipeline,
    });

    expect(result.status).toBe(ReviewStatus.SUCCEEDED);
    expect(result.recovered).toBe(true);
    expect(result.githubReviewId).toBe(777111);
    expect(m2PrepareCalled).toBe(false);

    // Verify ReviewRun in database updated to SUCCEEDED with review ID
    const updated = await prisma.reviewRun.findUnique({
      where: { id: run.id },
    });
    expect(updated?.status).toBe(ReviewStatus.SUCCEEDED);
    expect(updated?.githubReviewId).toBe(777111n);
  });

  it("reconciles marker even if PR head has advanced to a newer commit (evaluates against original expected head)", async () => {
    const prisma = createMockPrismaClient();
    const { run, claimToken } = await setupRun(prisma);
    const marker = formatReviewMarker(run.id);

    const existingReview = {
      id: 777222,
      body: `Review from initial commit\n\n${marker}`,
      state: "COMMENTED",
      commit_id: headSha, // Matches original expected commit
      user: { login: "reviewlens[bot]", type: "Bot", id: 12345 },
    };

    // Current PR head in GitHub has advanced to a newer commit!
    const fakeGithub = new FakeGitHubPullRequestClient({
      prInfo: {
        state: "open",
        headSha: "newer_head_sha_999999999999999999999999",
        baseSha,
        prNumber,
        changedFilesCount: 5,
      },
      reviews: [existingReview],
    });

    const result = await processReviewJob(prisma, run.id, {
      claimToken,
      attempt: 1,
      githubClient: fakeGithub,
    });

    expect(result.status).toBe(ReviewStatus.SUCCEEDED);
    expect(result.recovered).toBe(true);
    expect(result.githubReviewId).toBe(777222);
  });

  it("ignores marker authored by a non-App user and proceeds to diff pipeline", async () => {
    const prisma = createMockPrismaClient();
    const { run, claimToken } = await setupRun(prisma);
    const marker = formatReviewMarker(run.id);

    // Contributor copied the marker into their own review comment
    const userCopiedReview = {
      id: 888111,
      body: `User comment trying to forge marker\n\n${marker}`,
      state: "COMMENTED",
      commit_id: headSha,
      user: { login: "some-human-user", type: "User", id: 54321 },
    };

    const fakeGithub = new FakeGitHubPullRequestClient({
      prInfo: {
        state: "open",
        headSha,
        baseSha,
        prNumber,
        changedFilesCount: 1,
      },
      reviews: [userCopiedReview],
      files: [
        {
          filename: "src/index.ts",
          status: "modified",
          additions: 1,
          deletions: 0,
          changes: 1,
          patch: "@@ -0,0 +1,1 @@\n+line",
        },
      ],
      contents: {
        [`.reviewlens.yml@${baseSha}`]: "version: 1\n",
      },
    });

    const result = await processReviewJob(prisma, run.id, {
      claimToken,
      attempt: 1,
      githubClient: fakeGithub,
    });

    // Did NOT recover user's comment; proceeded with review pipeline
    expect(result.recovered).toBeUndefined();
    expect(result.status).toBe(ReviewStatus.SUCCEEDED);
  });

  it("fails closed when App-authored review exists with marker but different commit SHA", async () => {
    const prisma = createMockPrismaClient();
    const { run, claimToken } = await setupRun(prisma);
    const marker = formatReviewMarker(run.id);

    // Anomaly: App review with marker on different commit
    const conflictingReview = {
      id: 999111,
      body: `App review\n\n${marker}`,
      state: "COMMENTED",
      commit_id: "different_commit_sha_0000000000000000000",
      user: { login: "reviewlens[bot]", type: "Bot", id: 12345 },
    };

    const fakeGithub = new FakeGitHubPullRequestClient({
      prInfo: {
        state: "open",
        headSha,
        baseSha,
        prNumber,
      },
      reviews: [conflictingReview],
    });

    await expect(
      processReviewJob(prisma, run.id, {
        claimToken,
        attempt: 1,
        githubClient: fakeGithub,
      }),
    ).rejects.toThrow("Publication integrity anomaly");

    const updated = await prisma.reviewRun.findUnique({
      where: { id: run.id },
    });
    expect(updated?.status).toBe(ReviewStatus.FAILED);
  });

  it("fails closed when multiple valid App-authored marker reviews exist", async () => {
    const prisma = createMockPrismaClient();
    const { run, claimToken } = await setupRun(prisma);
    const marker = formatReviewMarker(run.id);

    const r1 = {
      id: 111,
      body: `Review 1\n\n${marker}`,
      state: "COMMENTED",
      commit_id: headSha,
      user: { login: "reviewlens[bot]", type: "Bot", id: 12345 },
    };
    const r2 = {
      id: 222,
      body: `Review 2\n\n${marker}`,
      state: "COMMENTED",
      commit_id: headSha,
      user: { login: "reviewlens[bot]", type: "Bot", id: 12345 },
    };

    const fakeGithub = new FakeGitHubPullRequestClient({
      prInfo: {
        state: "open",
        headSha,
        baseSha,
        prNumber,
      },
      reviews: [r1, r2],
    });

    await expect(
      processReviewJob(prisma, run.id, {
        claimToken,
        attempt: 1,
        githubClient: fakeGithub,
      }),
    ).rejects.toThrow("Multiple App-authored reviews");
  });

  it("fails closed when an unresolved PENDING review containing marker exists", async () => {
    const prisma = createMockPrismaClient();
    const { run, claimToken } = await setupRun(prisma);
    const marker = formatReviewMarker(run.id);

    const pendingReview = {
      id: 333,
      body: `Pending review draft\n\n${marker}`,
      state: "PENDING",
      commit_id: headSha,
      user: { login: "reviewlens[bot]", type: "Bot", id: 12345 },
    };

    const fakeGithub = new FakeGitHubPullRequestClient({
      prInfo: {
        state: "open",
        headSha,
        baseSha,
        prNumber,
      },
      reviews: [pendingReview],
    });

    await expect(
      processReviewJob(prisma, run.id, {
        claimToken,
        attempt: 1,
        githubClient: fakeGithub,
      }),
    ).rejects.toThrow("PENDING review exists");
  });
});
