import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  InstallationStatus,
  ReviewStatus,
} from "../generated/prisma/client.js";
import { processReviewJob } from "../workers/review-processor.js";
import { FakeGitHubPullRequestClient } from "../github/fake-client.js";
import { createMockPrismaClient } from "./mock-prisma.js";

describe("GitHub Review Publishing & Controlled 422 Fallback (M3 Step 5)", () => {
  const headSha = "1111111111111111111111111111111111111111";
  const baseSha = "2222222222222222222222222222222222222222";
  const prNumber = 202;

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

  it("submits one batched COMMENT review with explicit headSha and inline comments", async () => {
    const prisma = createMockPrismaClient();
    const { run, claimToken } = await setupRun(prisma);

    const configYaml = [
      "version: 1",
      "rules:",
      "  - id: no-console",
      "    type: forbid_regex",
      "    enabled: true",
      "    pattern: 'console\\.log'",
      "    message: 'No console logs'",
    ].join("\n");

    const fakeGithub = new FakeGitHubPullRequestClient({
      prInfo: {
        state: "open",
        headSha,
        baseSha,
        prNumber,
        changedFilesCount: 1,
      },
      reviews: [],
      files: [
        {
          filename: "src/app.ts",
          status: "modified",
          additions: 1,
          deletions: 0,
          changes: 1,
          patch: "@@ -0,0 +1,1 @@\n+console.log('test');",
        },
      ],
      contents: {
        [`.reviewlens.yml@${baseSha}`]: configYaml,
      },
    });

    const result = await processReviewJob(prisma, run.id, {
      claimToken,
      attempt: 1,
      githubClient: fakeGithub,
    });

    expect(result.status).toBe(ReviewStatus.SUCCEEDED);
    expect(result.githubReviewId).toBeDefined();

    // Verify batched review payload on GitHub
    expect(fakeGithub.batchedReviewsCreated).toHaveLength(1);
    const created = fakeGithub.batchedReviewsCreated[0]!;
    expect(created.input.event).toBe("COMMENT");
    expect(created.input.commitSha).toBe(headSha);
    expect(created.input.comments).toHaveLength(1);
    expect(created.input.comments![0]?.path).toBe("src/app.ts");
    expect(created.input.comments![0]?.line).toBe(1);
    expect(created.input.comments![0]?.side).toBe("RIGHT");
  });

  it("does not publish an empty review when zero findings are found and coverage is complete", async () => {
    const prisma = createMockPrismaClient();
    const { run, claimToken } = await setupRun(prisma);

    const configYaml = [
      "version: 1",
      "rules:",
      "  - id: no-console",
      "    type: forbid_regex",
      "    enabled: true",
      "    pattern: 'console\\.log'",
      "    message: 'No console logs'",
    ].join("\n");

    const fakeGithub = new FakeGitHubPullRequestClient({
      prInfo: {
        state: "open",
        headSha,
        baseSha,
        prNumber,
        changedFilesCount: 1,
      },
      reviews: [],
      files: [
        {
          filename: "src/clean.ts",
          status: "modified",
          additions: 1,
          deletions: 0,
          changes: 1,
          patch: "@@ -0,0 +1,1 @@\n+logger.info('clean');",
        },
      ],
      contents: {
        [`.reviewlens.yml@${baseSha}`]: configYaml,
      },
    });

    const result = await processReviewJob(prisma, run.id, {
      claimToken,
      attempt: 1,
      githubClient: fakeGithub,
    });

    expect(result.status).toBe(ReviewStatus.SUCCEEDED);
    expect(result.githubReviewId).toBeUndefined();
    // ZERO reviews created on GitHub!
    expect(fakeGithub.reviewsCreated).toHaveLength(0);
    expect(fakeGithub.batchedReviewsCreated).toHaveLength(0);

    const updated = await prisma.reviewRun.findUnique({
      where: { id: run.id },
    });
    expect(updated?.status).toBe(ReviewStatus.SUCCEEDED);
    expect(updated?.githubReviewId).toBeNull();
  });

  it("publishes warning review when there are zero findings but coverage is partial", async () => {
    const prisma = createMockPrismaClient();
    const { run, claimToken } = await setupRun(prisma);

    const configYaml = [
      "version: 1",
      "rules:",
      "  - id: no-console",
      "    type: forbid_regex",
      "    enabled: true",
      "    pattern: 'console\\.log'",
      "    message: 'No console logs'",
    ].join("\n");

    const fakeGithub = new FakeGitHubPullRequestClient({
      prInfo: {
        state: "open",
        headSha,
        baseSha,
        prNumber,
        changedFilesCount: 1,
      },
      reviews: [],
      files: [
        {
          filename: "src/binary.png",
          status: "modified",
          additions: 0,
          deletions: 0,
          changes: 0,
          patch: undefined, // Missing patch produces partial coverage!
        },
      ],
      contents: {
        [`.reviewlens.yml@${baseSha}`]: configYaml,
      },
    });

    const result = await processReviewJob(prisma, run.id, {
      claimToken,
      attempt: 1,
      githubClient: fakeGithub,
    });

    expect(result.status).toBe(ReviewStatus.SUCCEEDED);
    expect(result.githubReviewId).toBeDefined();

    // Published 1 review with summary warning and 0 inline comments
    expect(fakeGithub.batchedReviewsCreated).toHaveLength(1);
    const created = fakeGithub.batchedReviewsCreated[0]!;
    expect(created.input.comments).toHaveLength(0);
    expect(created.input.body).toContain("Partial Review Coverage");
  });

  it("triggers one-time summary-only fallback on HTTP 422 inline coordinate error", async () => {
    const prisma = createMockPrismaClient();
    const { run, claimToken } = await setupRun(prisma);

    const configYaml = [
      "version: 1",
      "rules:",
      "  - id: no-console",
      "    type: forbid_regex",
      "    enabled: true",
      "    pattern: 'console\\.log'",
      "    message: 'No console logs'",
    ].join("\n");

    // Simulate 422 line coordinate error on first review attempt
    const error422 = new Error(
      "Validation Failed: comments[0].line is not part of the pull request diff",
    );
    (error422 as unknown as { status: number }).status = 422;
    (error422 as unknown as { response: { data: unknown } }).response = {
      data: {
        message: "Validation Failed",
        errors: [
          {
            resource: "PullRequestReviewComment",
            field: "line",
            code: "invalid",
          },
        ],
      },
    };

    let attemptCount = 0;
    const fakeGithub = new FakeGitHubPullRequestClient({
      prInfo: {
        state: "open",
        headSha,
        baseSha,
        prNumber,
        changedFilesCount: 1,
      },
      reviews: [],
      files: [
        {
          filename: "src/app.ts",
          status: "modified",
          additions: 1,
          deletions: 0,
          changes: 1,
          patch: "@@ -0,0 +1,1 @@\n+console.log('test');",
        },
      ],
      contents: {
        [`.reviewlens.yml@${baseSha}`]: configYaml,
      },
    });

    // Custom createReview behavior: fails first time with 422, succeeds on fallback
    const originalCreateReview = fakeGithub.createReview.bind(fakeGithub);
    fakeGithub.createReview = async (owner, repo, pr, input, options) => {
      attemptCount++;
      if (attemptCount === 1) {
        throw error422;
      }
      return originalCreateReview(owner, repo, pr, input, options);
    };

    const result = await processReviewJob(prisma, run.id, {
      claimToken,
      attempt: 1,
      githubClient: fakeGithub,
    });

    expect(result.status).toBe(ReviewStatus.SUCCEEDED);
    expect(result.githubReviewId).toBeDefined();

    // Verify 2 attempts were made: 1st with comments (failed), 2nd fallback with comments: []
    expect(attemptCount).toBe(2);
    expect(fakeGithub.batchedReviewsCreated).toHaveLength(1);
    const fallbackCall = fakeGithub.batchedReviewsCreated[0]!;
    expect(fallbackCall.input.comments).toHaveLength(0);
    expect(fallbackCall.input.body).toContain(
      "Inline comments were rejected by GitHub coordinate validation",
    );
  });

  it("does NOT fallback on generic 422 (e.g. spam/abuse limit) and fails closed", async () => {
    const prisma = createMockPrismaClient();
    const { run, claimToken } = await setupRun(prisma);

    const configYaml = [
      "version: 1",
      "rules:",
      "  - id: no-console",
      "    type: forbid_regex",
      "    enabled: true",
      "    pattern: 'console\\.log'",
      "    message: 'No console logs'",
    ].join("\n");

    const spamError422 = new Error(
      "Validation Failed: abuse detection mechanism triggered",
    );
    (spamError422 as unknown as { status: number }).status = 422;
    (spamError422 as unknown as { response: { data: unknown } }).response = {
      data: { message: "spam limit reached" },
    };

    const fakeGithub = new FakeGitHubPullRequestClient({
      prInfo: {
        state: "open",
        headSha,
        baseSha,
        prNumber,
        changedFilesCount: 1,
      },
      reviews: [],
      files: [
        {
          filename: "src/app.ts",
          status: "modified",
          additions: 1,
          deletions: 0,
          changes: 1,
          patch: "@@ -0,0 +1,1 @@\n+console.log('test');",
        },
      ],
      contents: {
        [`.reviewlens.yml@${baseSha}`]: configYaml,
      },
      shouldFailCreateReviewWith: spamError422,
    });

    await expect(
      processReviewJob(prisma, run.id, {
        claimToken,
        attempt: 1,
        githubClient: fakeGithub,
      }),
    ).rejects.toThrow("abuse detection mechanism triggered");

    // ZERO successful reviews
    expect(fakeGithub.reviewsCreated).toHaveLength(0);
  });
});
