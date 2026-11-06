import { describe, it, expect } from "vitest";
import { createMockPrismaClient } from "./mock-prisma.js";
import { executeAIReview } from "../ai/orchestrator.js";
import { ReplayModel } from "../ai/models/replay-model.js";
import { ModelRouter } from "../ai/models/model-router.js";
import { PINNED_MODELS, type AIConfig } from "../ai/config.js";
import type { GitHubPullRequestClient } from "../github/pull-request-client.js";
import type { PreparedReviewInput } from "../pipeline/types.js";
import type { PullRequestDiffPipeline } from "../pipeline/index.js";
import { processReviewJob } from "../workers/review-processor.js";
import {
  InstallationStatus,
  ReviewStatus,
  ReviewTrigger,
} from "../generated/prisma/client.js";

describe("M4 End-to-End Orchestrator and Pipeline Integration", () => {
  const samplePrepared: PreparedReviewInput = {
    repository: { id: 101, owner: "octocat", name: "hello-world" },
    pullRequest: {
      number: 7,
      state: "open",
      isDraft: false,
      baseSha: "base123456789012345678901234567890123456",
      baseRef: "main",
      headSha: "head123456789012345678901234567890123456",
      headRef: "feature",
      changedFilesCount: 1,
    },
    configuration: {
      source: "base_commit",
      baseSha: "base123456789012345678901234567890123456",
      status: "loaded",
      config: {
        version: 1,
        review: { max_inline_comments: 5 },
        rules: [
          {
            id: "no-eval",
            type: "forbid_regex",
            enabled: true,
            pattern: "eval\\(",
            message: "eval is dangerous",
            severity: "critical",
          },
        ],
      },
      warnings: [],
    },
    completeness: {
      expectedFileCount: 1,
      receivedFileCount: 1,
      paginationComplete: true,
      revisionVerified: true,
    },
    files: [
      {
        metadata: {
          path: "src/calc.ts",
          status: "modified",
          additions: 2,
          deletions: 0,
          changes: 2,
          patch:
            "@@ -1,1 +1,3 @@\n+eval('2 + 2');\n+const leaked = 'insecure_mode';",
        },
        filterDecision: {
          path: "src/calc.ts",
          included: true,
          reason: "default_include",
        },
        parseStatus: "parsed",
        diff: {
          path: "src/calc.ts",
          parseStatus: "parsed",
          additions: 2,
          deletions: 0,
          hunks: [
            {
              oldStart: 1,
              oldCount: 1,
              newStart: 1,
              newCount: 3,
              header: "@@ -1,1 +1,3 @@",
              lines: [
                {
                  kind: "addition",
                  content: "eval('2 + 2');",
                  newLine: 1,
                },
                {
                  kind: "addition",
                  content: "const leaked = 'insecure_mode';",
                  newLine: 2,
                },
              ],
            },
          ],
        },
        locations: {
          find: () => undefined,
          getAllForPath: () => [
            {
              path: "src/calc.ts",
              side: "RIGHT" as const,
              line: 1,
              kind: "addition" as const,
              isChanged: true,
              content: "eval('2 + 2');",
              hunkIndex: 0,
              commitSha: "head123456789012345678901234567890123456",
            },
            {
              path: "src/calc.ts",
              side: "RIGHT" as const,
              line: 2,
              kind: "addition" as const,
              isChanged: true,
              content: "const leaked = 'insecure_mode';",
              hunkIndex: 0,
              commitSha: "head123456789012345678901234567890123456",
            },
          ],
          getAll: () => [],
          size: 2,
        },
      },
    ],
    diagnostics: [],
  };

  const mockGithubClient: Partial<GitHubPullRequestClient> = {
    getFileContent: async () =>
      "eval('2 + 2');\nconst leaked = 'insecure_mode';",
    getPullRequest: async () => ({
      state: "open",
      headSha: "head123456789012345678901234567890123456",
      baseSha: "base123456789012345678901234567890123456",
      prNumber: 7,
    }),
    listReviews: async () => [],
    createReview: async () => ({ id: 99999 }),
  };

  it("executes AI review, validates candidate findings, and persists DB records", async () => {
    const prisma = createMockPrismaClient();
    const runId = "test-run-m4-01";

    const replay = new ReplayModel({
      defaultFindings: [
        {
          file_path: "src/calc.ts",
          line: 2,
          side: "RIGHT",
          category: "security",
          severity: "high",
          confidence: 0.9,
          title: "Insecure mode enabled",
          message: "Enabling insecure mode bypasses authentication checks.",
          evidence_quote: "const leaked = 'insecure_mode';",
        },
      ],
    });

    const router = new ModelRouter({
      profile: "development",
      models: new Map([[PINNED_MODELS.GEMINI_3_5_FLASH_LITE, replay]]),
    });

    const aiConfig: AIConfig = {
      enabled: true,
      killSwitch: false,
      profile: "development",
    };

    const result = await executeAIReview(
      prisma,
      mockGithubClient as GitHubPullRequestClient,
      samplePrepared,
      {
        runId,
        config: aiConfig,
        modelRouter: router,
      },
    );

    expect(result.status).toBe("COMPLETE");
    expect(result.validatedFindings).toHaveLength(1);
    expect(result.validatedFindings[0]?.code).toBe("AI_SECURITY");
    expect(result.coverageNotice).toContain("AI review: 1 chunk(s) analyzed");

    // Verify DB records
    const execDb = await prisma.aIReviewExecution.findUnique({
      where: { reviewRunId: runId },
    });
    expect(execDb?.status).toBe("COMPLETE");
    expect(execDb?.completedChunks).toBe(1);
    expect(execDb?.totalCandidatesValidated).toBe(1);
  });

  it("integrates AI review into worker pipeline, merging deterministic and AI findings", async () => {
    const prisma = createMockPrismaClient();
    const runId = "test-run-worker-m4";

    // Seed installation and repo
    const inst = await prisma.installation.create({
      data: {
        githubInstallationId: 1234n,
        accountLogin: "octocat",
        accountType: "Organization",
        status: InstallationStatus.ACTIVE,
      },
    });

    const repo = await prisma.repository.create({
      data: {
        installationId: inst.id,
        githubRepoId: 101n,
        fullName: "octocat/hello-world",
        enabled: true,
      },
    });

    await prisma.reviewRun.create({
      data: {
        id: runId,
        repositoryId: repo.id,
        prNumber: 7,
        headSha: "head123456789012345678901234567890123456",
        baseSha: "base123456789012345678901234567890123456",
        status: ReviewStatus.QUEUED,
        trigger: ReviewTrigger.WEBHOOK,
      },
    });

    const replay = new ReplayModel({
      defaultFindings: [
        {
          file_path: "src/calc.ts",
          line: 2,
          side: "RIGHT",
          category: "security",
          severity: "high",
          confidence: 0.9,
          title: "Insecure mode enabled",
          message: "Enabling insecure mode bypasses authentication checks.",
          evidence_quote: "const leaked = 'insecure_mode';",
        },
      ],
    });

    const router = new ModelRouter({
      profile: "development",
      models: new Map([[PINNED_MODELS.GEMINI_3_5_FLASH_LITE, replay]]),
    });

    const aiConfig: AIConfig = {
      enabled: true,
      killSwitch: false,
      profile: "development",
    };

    // Mock pipeline
    const mockPipeline = {
      prepare: async () => samplePrepared,
    };

    let postedReviewBody = "";
    const spyGithubClient: Partial<GitHubPullRequestClient> = {
      ...mockGithubClient,
      createReview: async (_o, _r, _pr, input) => {
        postedReviewBody = input.body;
        return { id: 777 };
      },
    };

    const processResult = await processReviewJob(prisma, runId, {
      claimToken: "claim-worker-token",
      attempt: 1,
      githubClient: spyGithubClient as GitHubPullRequestClient,
      pipeline: mockPipeline as unknown as PullRequestDiffPipeline,
      aiConfig,
      modelRouter: router,
    });

    expect(processResult.status).toBe(ReviewStatus.SUCCEEDED);
    expect(processResult.evalResult?.findingsCount).toBe(2); // 1 deterministic (eval) + 1 AI (insecure_mode)

    // Verify posted summary includes AI coverage notice
    expect(postedReviewBody).toContain("AI review: 1 chunk(s) analyzed");
    expect(postedReviewBody).toContain(
      "<!-- reviewlens:run:test-run-worker-m4 -->",
    );
  });

  it("handles fallback to secondary model when primary model encounters rate limit", async () => {
    const prisma = createMockPrismaClient();
    const runId = "test-run-fallback-m4";

    const failingPrimary = new ReplayModel({
      modelId: PINNED_MODELS.GEMINI_3_5_FLASH_LITE,
      cannedResponses: [
        new Error("429 Too Many Requests: Rate limit exceeded"),
        new Error("429 Too Many Requests: Rate limit exceeded"),
      ],
    });

    const successfulFallback = new ReplayModel({
      modelId: PINNED_MODELS.GROQ_GPT_OSS_120B,
      defaultFindings: [
        {
          file_path: "src/calc.ts",
          line: 2,
          side: "RIGHT",
          category: "reliability",
          severity: "medium",
          confidence: 0.85,
          title: "Hardcoded flag value",
          message: "Consider extracting this flag to configuration.",
          evidence_quote: "const leaked = 'insecure_mode';",
        },
      ],
    });

    const router = new ModelRouter({
      profile: "development",
      models: new Map([
        [PINNED_MODELS.GEMINI_3_5_FLASH_LITE, failingPrimary],
        [PINNED_MODELS.GROQ_GPT_OSS_120B, successfulFallback],
      ]),
    });

    const aiConfig: AIConfig = {
      enabled: true,
      killSwitch: false,
      profile: "development",
    };

    const result = await executeAIReview(
      prisma,
      mockGithubClient as GitHubPullRequestClient,
      samplePrepared,
      {
        runId,
        config: aiConfig,
        modelRouter: router,
      },
    );

    expect(result.status).toBe("COMPLETE");
    expect(result.summary.finalModel).toBe(PINNED_MODELS.GROQ_GPT_OSS_120B);
    expect(result.validatedFindings).toHaveLength(1);
  });

  it("enforces strict deterministic precedence: if deterministic evaluation fails closed, AI is never invoked", async () => {
    const prisma = createMockPrismaClient();
    const runId = "test-run-deterministic-precedence";

    const inst = await prisma.installation.create({
      data: {
        githubInstallationId: 9999n,
        accountLogin: "octocat",
        accountType: "Organization",
        status: InstallationStatus.ACTIVE,
      },
    });

    const repo = await prisma.repository.create({
      data: {
        installationId: inst.id,
        githubRepoId: 202n,
        fullName: "octocat/hello-world",
        enabled: true,
      },
    });

    await prisma.reviewRun.create({
      data: {
        id: runId,
        repositoryId: repo.id,
        prNumber: 7,
        headSha: "head123456789012345678901234567890123456",
        baseSha: "base123456789012345678901234567890123456",
        status: ReviewStatus.QUEUED,
        trigger: ReviewTrigger.WEBHOOK,
      },
    });

    // Prepared input with INVALID repository config (must fail closed)
    const invalidConfigPrepared: PreparedReviewInput = {
      ...samplePrepared,
      configuration: {
        source: "base_commit",
        baseSha: "base123456789012345678901234567890123456",
        status: "invalid_defaulted",
        config: { version: 1 },
        warnings: ["Syntax error in .reviewlens.yml at line 4"],
      },
    };

    const trackingReplay = new ReplayModel({
      modelId: PINNED_MODELS.GEMINI_3_5_FLASH_LITE,
      cannedResponses: [
        {
          status: "success",
          rawFindings: [],
          inputTokens: 10,
          outputTokens: 10,
          latencyMs: 10,
        },
      ],
    });

    const router = new ModelRouter({
      profile: "development",
      models: new Map([[PINNED_MODELS.GEMINI_3_5_FLASH_LITE, trackingReplay]]),
    });

    const processResult = await processReviewJob(prisma, runId, {
      claimToken: "claim-precedence-token",
      attempt: 1,
      githubClient: mockGithubClient as GitHubPullRequestClient,
      pipeline: {
        prepare: async () => invalidConfigPrepared,
      } as unknown as PullRequestDiffPipeline,
      aiConfig: {
        enabled: true,
        killSwitch: false,
        profile: "development",
      },
      modelRouter: router,
    });

    expect(processResult.status).toBe(ReviewStatus.FAILED);
    expect(processResult.reason).toContain(
      "Repository configuration on base commit is invalid",
    );
    // CRITICAL: Deterministic evaluation failed closed before any AI invocation
    expect(trackingReplay.getCalls()).toBe(0);
  });

  it("resumes from crashed worker run by skipping already COMPLETE chunks", async () => {
    const prisma = createMockPrismaClient();
    const runId = "test-run-crash-recovery";

    // Pre-populate an AIReviewExecution and an already COMPLETE chunk
    const exec = await prisma.aIReviewExecution.create({
      data: {
        reviewRunId: runId,
        status: "RUNNING",
        profile: "development",
        primaryModel: PINNED_MODELS.GEMINI_3_5_FLASH_LITE,
        totalChunks: 1,
      },
    });

    await prisma.aIReviewChunk.create({
      data: {
        executionId: exec.id,
        chunkIndex: 0,
        filePaths: ["src/calc.ts"],
        modelId: PINNED_MODELS.GEMINI_3_5_FLASH_LITE,
        status: "COMPLETE",
        inputTokens: 150,
        outputTokens: 50,
      },
    });

    const replay = new ReplayModel({
      modelId: PINNED_MODELS.GEMINI_3_5_FLASH_LITE,
      cannedResponses: [
        {
          status: "success",
          rawFindings: [],
          inputTokens: 100,
          outputTokens: 40,
          latencyMs: 50,
        },
      ],
    });

    const router = new ModelRouter({
      profile: "development",
      models: new Map([[PINNED_MODELS.GEMINI_3_5_FLASH_LITE, replay]]),
    });

    const result = await executeAIReview(
      prisma,
      mockGithubClient as GitHubPullRequestClient,
      samplePrepared,
      {
        runId,
        config: {
          enabled: true,
          killSwitch: false,
          profile: "development",
        },
        modelRouter: router,
      },
    );

    expect(result.status).toBe("COMPLETE");
    // Since chunk 0 was already COMPLETE in DB, it should not have invoked the model for chunk 0
    expect(replay.getCalls()).toBe(0);
    // Aggregate tokens include tokens from the restored completed chunk
    expect(result.summary.totalInputTokens).toBeGreaterThanOrEqual(150);
  });

  it("aborts AI execution immediately when worker claim token is lost", async () => {
    const prisma = createMockPrismaClient();
    const runId = "test-run-claim-lost";

    const inst = await prisma.installation.create({
      data: {
        githubInstallationId: 7890n,
        accountLogin: "octocat",
        accountType: "Organization",
        status: InstallationStatus.ACTIVE,
      },
    });

    const repo = await prisma.repository.create({
      data: {
        installationId: inst.id,
        githubRepoId: 303n,
        fullName: "octocat/hello-world",
        enabled: true,
      },
    });

    await prisma.reviewRun.create({
      data: {
        id: runId,
        repositoryId: repo.id,
        prNumber: 7,
        headSha: "head123456789012345678901234567890123456",
        baseSha: "base123456789012345678901234567890123456",
        status: ReviewStatus.RUNNING,
        claimToken: "other-worker-token", // different token!
        trigger: ReviewTrigger.WEBHOOK,
      },
    });

    const router = new ModelRouter({
      profile: "development",
      models: new Map([
        [
          PINNED_MODELS.GEMINI_3_5_FLASH_LITE,
          new ReplayModel({ modelId: PINNED_MODELS.GEMINI_3_5_FLASH_LITE }),
        ],
      ]),
    });

    const result = await executeAIReview(
      prisma,
      mockGithubClient as GitHubPullRequestClient,
      samplePrepared,
      {
        runId,
        claimToken: "my-stale-worker-token",
        config: {
          enabled: true,
          killSwitch: false,
          profile: "development",
        },
        modelRouter: router,
      },
    );

    expect(result.status).toBe("CANCELLED");
    expect(result.summary.failureReason).toContain("Worker claim token lost");
  });

  it("does not fallback or retry on SAFETY_REFUSAL or BAD_REQUEST errors", async () => {
    const prisma = createMockPrismaClient();
    const runId = "test-run-safety-refusal";

    const safetyFailingPrimary = new ReplayModel({
      modelId: PINNED_MODELS.GEMINI_3_5_FLASH_LITE,
      cannedResponses: [
        new Error("Blocked by safety policy: content filter refusal"),
      ],
    });

    const secondaryModel = new ReplayModel({
      modelId: PINNED_MODELS.GROQ_GPT_OSS_120B,
      cannedResponses: [
        {
          status: "success",
          rawFindings: [],
          inputTokens: 10,
          outputTokens: 10,
          latencyMs: 10,
        },
      ],
    });

    const router = new ModelRouter({
      profile: "development",
      models: new Map([
        [PINNED_MODELS.GEMINI_3_5_FLASH_LITE, safetyFailingPrimary],
        [PINNED_MODELS.GROQ_GPT_OSS_120B, secondaryModel],
      ]),
    });

    const result = await executeAIReview(
      prisma,
      mockGithubClient as GitHubPullRequestClient,
      samplePrepared,
      {
        runId,
        config: {
          enabled: true,
          killSwitch: false,
          profile: "development",
        },
        modelRouter: router,
      },
    );

    // SAFETY_REFUSAL does not trigger fallback to secondary model
    expect(result.status).toBe("UNAVAILABLE");
    expect(secondaryModel.getCalls()).toBe(0);
    expect(result.summary.failureReason).toContain("Blocked by safety policy");
  });
});
