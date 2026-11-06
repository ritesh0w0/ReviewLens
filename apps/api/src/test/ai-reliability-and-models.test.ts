import { describe, it, expect, vi } from "vitest";
import { classifyAIError } from "../ai/reliability/errors.js";
import { CircuitBreaker } from "../ai/reliability/circuit-breaker.js";
import { ModelRateLimiter } from "../ai/reliability/rate-limiter.js";
import { ModelRouter } from "../ai/models/model-router.js";
import { ReplayModel } from "../ai/models/replay-model.js";
import {
  PINNED_MODELS,
  type AIConfig,
  type PinnedModelId,
} from "../ai/config.js";
import { STRUCTURED_OUTPUT_JSON_SCHEMA } from "../ai/validation/structured-output-schema.js";
import { createMockPrismaClient } from "./mock-prisma.js";
import { executeAIReview } from "../ai/orchestrator.js";
import { evaluatePullRequestReview } from "../review/review-orchestrator.js";
import type { GitHubPullRequestClient } from "../github/pull-request-client.js";
import type { PreparedReviewInput } from "../pipeline/types.js";
import { deduplicateFindings } from "@reviewlens/core";

describe("M4 and M6.5 Reliability, Model Router and Fallback Suite", () => {
  describe("AI Error Classification", () => {
    it("distinguishes RPM rate limit from daily RPD quota exhaustion", () => {
      const rpmErr = new Error("429 Too Many Requests: Rate limit exceeded");
      const rpdErr = new Error(
        "429 Resource Exhausted: daily quota per day limit exceeded",
      );

      const classifiedRpm = classifyAIError(rpmErr);
      expect(classifiedRpm.category).toBe("RATE_LIMIT_RPM");
      expect(classifiedRpm.retryable).toBe(true);

      const classifiedRpd = classifyAIError(rpdErr);
      expect(classifiedRpd.category).toBe("RATE_LIMIT_RPD");
      expect(classifiedRpd.retryable).toBe(false);
    });

    it("classifies authentication, timeout, server error, and safety refusal errors", () => {
      expect(
        classifyAIError(new Error("401 Invalid API Key provided")).category,
      ).toBe("AUTHENTICATION");

      expect(classifyAIError(new Error("504 Gateway Timeout")).category).toBe(
        "TIMEOUT",
      );

      expect(
        classifyAIError(new Error("500 Internal Server Error")).category,
      ).toBe("SERVER_ERROR");

      expect(
        classifyAIError(
          new Error("Blocked by safety policy: content filter refusal"),
        ).category,
      ).toBe("SAFETY_REFUSAL");
    });
  });

  describe("Circuit Breaker", () => {
    it("trips from CLOSED to OPEN after 3 consecutive failures", () => {
      const cb = new CircuitBreaker({
        failureThreshold: 3,
        resetTimeoutMs: 50,
      });

      expect(cb.getState()).toBe("CLOSED");
      expect(cb.isCallPermitted()).toBe(true);

      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getState()).toBe("CLOSED");

      cb.recordFailure(); // 3rd failure trips
      expect(cb.getState()).toBe("OPEN");
      expect(cb.isCallPermitted()).toBe(false);
    });

    it("transitions from OPEN to HALF_OPEN after cooldown and recovers to CLOSED on success", async () => {
      const cb = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeoutMs: 20,
      });
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getState()).toBe("OPEN");

      await new Promise((r) => setTimeout(r, 25));
      expect(cb.getState()).toBe("HALF_OPEN");
      expect(cb.isCallPermitted()).toBe(true);

      cb.recordSuccess();
      expect(cb.getState()).toBe("CLOSED");
      expect(cb.isCallPermitted()).toBe(true);
    });
  });

  describe("Model Rate Limiter", () => {
    it("permits reservation within RPM and TPM ceilings", () => {
      const limiter = new ModelRateLimiter({
        [PINNED_MODELS.GEMINI_3_5_FLASH_LITE]: {
          maxRpm: 2,
          maxTpm: 5000,
          maxRpd: 10,
        },
      });

      const res1 = limiter.reserve(PINNED_MODELS.GEMINI_3_5_FLASH_LITE, 1000);
      expect(res1.allowed).toBe(true);

      const res2 = limiter.reserve(PINNED_MODELS.GEMINI_3_5_FLASH_LITE, 1000);
      expect(res2.allowed).toBe(true);

      // 3rd call exceeds maxRpm=2
      const res3 = limiter.reserve(PINNED_MODELS.GEMINI_3_5_FLASH_LITE, 1000);
      expect(res3.allowed).toBe(false);
      expect(res3.reason).toContain("RPM ceiling");
    });
  });

  describe("Model Router and Sticky Fallback", () => {
    it("starts with primary model and cascades across full 3-tier hierarchy", () => {
      const primary = new ReplayModel({
        modelId: PINNED_MODELS.GEMINI_3_5_FLASH_LITE,
      });
      const secondary = new ReplayModel({
        modelId: PINNED_MODELS.GEMINI_3_6_FLASH,
      });
      const tertiary = new ReplayModel({
        modelId: PINNED_MODELS.GROQ_GPT_OSS_120B,
      });

      const models = new Map<PinnedModelId, ReplayModel>([
        [PINNED_MODELS.GEMINI_3_5_FLASH_LITE, primary],
        [PINNED_MODELS.GEMINI_3_6_FLASH, secondary],
        [PINNED_MODELS.GROQ_GPT_OSS_120B, tertiary],
      ]);

      const router = new ModelRouter({
        profile: "development",
        models,
        rateLimiter: new ModelRateLimiter(),
      });

      expect(router.getActiveModelId()).toBe(
        PINNED_MODELS.GEMINI_3_5_FLASH_LITE,
      );

      // 1st fallback: switches to secondary (gemini-3.6-flash)
      const fb1 = router.fallback();
      expect(fb1.switched).toBe(true);
      expect(fb1.newModelId).toBe(PINNED_MODELS.GEMINI_3_6_FLASH);
      expect(router.getActiveModelId()).toBe(PINNED_MODELS.GEMINI_3_6_FLASH);

      // 2nd fallback: switches to tertiary (openai/gpt-oss-120b)
      const fb2 = router.fallback();
      expect(fb2.switched).toBe(true);
      expect(fb2.newModelId).toBe(PINNED_MODELS.GROQ_GPT_OSS_120B);
      expect(router.getActiveModelId()).toBe(PINNED_MODELS.GROQ_GPT_OSS_120B);

      // 3rd fallback: chain is exhausted
      const fb3 = router.fallback();
      expect(fb3.switched).toBe(false);
      expect(router.getActiveModelId()).toBe(PINNED_MODELS.GROQ_GPT_OSS_120B);
    });
  });

  describe("GroqProvider Strict Structured Output", () => {
    it("pins model to openai/gpt-oss-120b and sends strict json_schema payload", async () => {
      let capturedPayload: Record<string, unknown> | undefined;
      vi.doMock("groq-sdk", () => {
        return {
          Groq: class {
            chat = {
              completions: {
                create: async (payload: Record<string, unknown>) => {
                  capturedPayload = payload;
                  return {
                    choices: [
                      {
                        message: {
                          content: JSON.stringify({ findings: [] }),
                        },
                      },
                    ],
                    usage: { prompt_tokens: 120, completion_tokens: 45 },
                  };
                },
              },
            };
          },
        };
      });

      const { GroqProvider } = await import("../ai/models/groq-provider.js");
      const provider = new GroqProvider(
        PINNED_MODELS.GROQ_GPT_OSS_120B,
        "gsk_test_key",
      );

      const result = await provider.invokeChunkReview({
        chunkIndex: 0,
        totalChunks: 1,
        modelId: PINNED_MODELS.GROQ_GPT_OSS_120B,
        files: [],
        repositoryFullName: "acme/repo",
        prNumber: 1,
        headSha: "head",
        baseSha: "base",
      });

      expect(result.status).toBe("success");
      expect(capturedPayload).toBeDefined();
      expect(capturedPayload?.model).toBe("openai/gpt-oss-120b");
      expect(capturedPayload?.response_format).toEqual({
        type: "json_schema",
        json_schema: {
          name: "reviewlens_findings_response",
          strict: true,
          schema: STRUCTURED_OUTPUT_JSON_SCHEMA,
        },
      });
      expect(capturedPayload?.temperature).toBe(0.1);
    });
  });

  describe("M6.5 LLM Fallback and Reliability Scenarios (15 Deterministic Cases)", () => {
    const validFindingCandidate = {
      file_path: "src/calc.ts",
      line: 2,
      side: "RIGHT" as const,
      category: "security" as const,
      severity: "critical" as const,
      confidence: 0.95,
      title: "Hardcoded Credential",
      message: "Potential credential leak detected.",
      evidence_quote: "const leaked = 'insecure_mode';",
    };

    const basePrepared: PreparedReviewInput = {
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

    const aiConfig: AIConfig = {
      enabled: true,
      killSwitch: false,
      profile: "development",
    };

    function createIsolatedRouter(
      models: Map<PinnedModelId, ReplayModel>,
    ): ModelRouter {
      return new ModelRouter({
        profile: "development",
        models,
        rateLimiter: new ModelRateLimiter(),
      });
    }

    // Scenario 1: Primary succeeds (no fallback)
    it("Scenario 1: Primary succeeds without triggering fallback", async () => {
      const prisma = createMockPrismaClient();
      const primary = new ReplayModel({
        modelId: PINNED_MODELS.GEMINI_3_5_FLASH_LITE,
        defaultFindings: [validFindingCandidate],
      });
      const secondary = new ReplayModel({
        modelId: PINNED_MODELS.GEMINI_3_6_FLASH,
      });
      const tertiary = new ReplayModel({
        modelId: PINNED_MODELS.GROQ_GPT_OSS_120B,
      });

      const router = createIsolatedRouter(
        new Map([
          [PINNED_MODELS.GEMINI_3_5_FLASH_LITE, primary],
          [PINNED_MODELS.GEMINI_3_6_FLASH, secondary],
          [PINNED_MODELS.GROQ_GPT_OSS_120B, tertiary],
        ]),
      );

      const result = await executeAIReview(
        prisma,
        mockGithubClient as GitHubPullRequestClient,
        basePrepared,
        { runId: "test-s1", config: aiConfig, modelRouter: router },
      );

      expect(result.status).toBe("COMPLETE");
      expect(result.summary.primaryModel).toBe(
        PINNED_MODELS.GEMINI_3_5_FLASH_LITE,
      );
      expect(result.summary.finalModel).toBe(
        PINNED_MODELS.GEMINI_3_5_FLASH_LITE,
      );
      expect(result.validatedFindings).toHaveLength(1);
      expect(prisma._storage.aiAttempts.size).toBe(1);
    });

    // Scenario 2: Primary rate-limited -> secondary succeeds
    it("Scenario 2: Primary rate-limited (RPD) falls back to secondary which succeeds", async () => {
      const prisma = createMockPrismaClient();
      const primary = new ReplayModel({
        modelId: PINNED_MODELS.GEMINI_3_5_FLASH_LITE,
        cannedResponses: [
          new Error(
            "429 Resource Exhausted: daily quota per day limit exceeded",
          ),
        ],
      });
      const secondary = new ReplayModel({
        modelId: PINNED_MODELS.GEMINI_3_6_FLASH,
        defaultFindings: [validFindingCandidate],
      });
      const tertiary = new ReplayModel({
        modelId: PINNED_MODELS.GROQ_GPT_OSS_120B,
      });

      const router = createIsolatedRouter(
        new Map([
          [PINNED_MODELS.GEMINI_3_5_FLASH_LITE, primary],
          [PINNED_MODELS.GEMINI_3_6_FLASH, secondary],
          [PINNED_MODELS.GROQ_GPT_OSS_120B, tertiary],
        ]),
      );

      const result = await executeAIReview(
        prisma,
        mockGithubClient as GitHubPullRequestClient,
        basePrepared,
        { runId: "test-s2", config: aiConfig, modelRouter: router },
      );

      expect(result.status).toBe("COMPLETE");
      expect(result.summary.finalModel).toBe(PINNED_MODELS.GEMINI_3_6_FLASH);
      expect(result.validatedFindings).toHaveLength(1);
      expect(prisma._storage.aiAttempts.size).toBe(2);
    });

    // Scenario 3: Primary unavailable -> secondary succeeds
    it("Scenario 3: Primary unavailable (503) falls back to secondary which succeeds", async () => {
      const prisma = createMockPrismaClient();
      const primary = new ReplayModel({
        modelId: PINNED_MODELS.GEMINI_3_5_FLASH_LITE,
        cannedResponses: [
          new Error("503 Service Unavailable: upstream overloaded"),
        ],
      });
      const secondary = new ReplayModel({
        modelId: PINNED_MODELS.GEMINI_3_6_FLASH,
        defaultFindings: [validFindingCandidate],
      });

      const router = createIsolatedRouter(
        new Map([
          [PINNED_MODELS.GEMINI_3_5_FLASH_LITE, primary],
          [PINNED_MODELS.GEMINI_3_6_FLASH, secondary],
        ]),
      );

      const result = await executeAIReview(
        prisma,
        mockGithubClient as GitHubPullRequestClient,
        basePrepared,
        { runId: "test-s3", config: aiConfig, modelRouter: router },
      );

      expect(result.status).toBe("COMPLETE");
      expect(result.summary.finalModel).toBe(PINNED_MODELS.GEMINI_3_6_FLASH);
      expect(result.validatedFindings).toHaveLength(1);
    });

    // Scenario 4: Primary and secondary fail -> Groq succeeds
    it("Scenario 4: Primary and secondary fail, cascading to Groq tertiary which succeeds", async () => {
      const prisma = createMockPrismaClient();
      const primary = new ReplayModel({
        modelId: PINNED_MODELS.GEMINI_3_5_FLASH_LITE,
        cannedResponses: [new Error("500 Internal Server Error")],
      });
      const secondary = new ReplayModel({
        modelId: PINNED_MODELS.GEMINI_3_6_FLASH,
        cannedResponses: [new Error("502 Bad Gateway")],
      });
      const tertiary = new ReplayModel({
        modelId: PINNED_MODELS.GROQ_GPT_OSS_120B,
        defaultFindings: [validFindingCandidate],
      });

      const router = createIsolatedRouter(
        new Map([
          [PINNED_MODELS.GEMINI_3_5_FLASH_LITE, primary],
          [PINNED_MODELS.GEMINI_3_6_FLASH, secondary],
          [PINNED_MODELS.GROQ_GPT_OSS_120B, tertiary],
        ]),
      );

      const result = await executeAIReview(
        prisma,
        mockGithubClient as GitHubPullRequestClient,
        basePrepared,
        { runId: "test-s4", config: aiConfig, modelRouter: router },
      );

      expect(result.status).toBe("COMPLETE");
      expect(result.summary.finalModel).toBe(PINNED_MODELS.GROQ_GPT_OSS_120B);
      expect(result.validatedFindings).toHaveLength(1);
      expect(prisma._storage.aiAttempts.size).toBe(3);
    });

    // Scenario 5: All providers fail -> deterministic degraded review
    it("Scenario 5: All providers fail, returning UNAVAILABLE so pipeline falls back to deterministic review", async () => {
      const prisma = createMockPrismaClient();
      const primary = new ReplayModel({
        modelId: PINNED_MODELS.GEMINI_3_5_FLASH_LITE,
        cannedResponses: [new Error("500 Error")],
      });
      const secondary = new ReplayModel({
        modelId: PINNED_MODELS.GEMINI_3_6_FLASH,
        cannedResponses: [new Error("500 Error")],
      });
      const tertiary = new ReplayModel({
        modelId: PINNED_MODELS.GROQ_GPT_OSS_120B,
        cannedResponses: [new Error("500 Error")],
      });

      const router = createIsolatedRouter(
        new Map([
          [PINNED_MODELS.GEMINI_3_5_FLASH_LITE, primary],
          [PINNED_MODELS.GEMINI_3_6_FLASH, secondary],
          [PINNED_MODELS.GROQ_GPT_OSS_120B, tertiary],
        ]),
      );

      const aiResult = await executeAIReview(
        prisma,
        mockGithubClient as GitHubPullRequestClient,
        basePrepared,
        { runId: "test-s5", config: aiConfig, modelRouter: router },
      );

      expect(aiResult.status).toBe("UNAVAILABLE");
      expect(aiResult.validatedFindings).toHaveLength(0);

      // Verify deterministic fallback in orchestrator
      const deterministicResult = evaluatePullRequestReview(basePrepared, {
        runId: "test-s5",
        additionalFindings: aiResult.validatedFindings,
        aiCoverageNotice: aiResult.coverageNotice,
      });

      expect(deterministicResult.hasReviewToPublish).toBe(true);
      expect(deterministicResult.validatedFindings).toHaveLength(1);
      expect(deterministicResult.validatedFindings[0]!.message).toContain(
        "eval is dangerous",
      );
    });

    // Scenario 6: Partial chunk success (1 succeeds, 1 fails)
    it("Scenario 6: Partial chunk success produces PARTIAL status and aggregates metrics", async () => {
      const prisma = createMockPrismaClient();

      // Create two large distinct files that exceed the 16,000 targetInputTokens threshold
      const largeHunkContent =
        "+const chunkLine = 'large_payload_padding';\n".repeat(800);
      const multiFilePrepared: PreparedReviewInput = {
        ...basePrepared,
        files: [
          {
            ...basePrepared.files[0]!,
            metadata: {
              ...basePrepared.files[0]!.metadata,
              path: "src/calc.ts",
              patch: `@@ -1,1 +1,800 @@\n${largeHunkContent}`,
            },
          },
          {
            ...basePrepared.files[0]!,
            metadata: {
              ...basePrepared.files[0]!.metadata,
              path: "src/utils.ts",
              patch: `@@ -1,1 +1,800 @@\n${largeHunkContent}`,
            },
            filterDecision: {
              path: "src/utils.ts",
              included: true,
              reason: "default_include",
            },
          },
        ],
      };

      // Primary succeeds on chunk 0, but fails on chunk 1 (and fallback also fails for chunk 1)
      const primary = new ReplayModel({
        modelId: PINNED_MODELS.GEMINI_3_5_FLASH_LITE,
        cannedResponses: [
          {
            status: "success",
            rawFindings: [validFindingCandidate],
            inputTokens: 100,
            outputTokens: 50,
            latencyMs: 10,
          },
          new Error("500 Chunk 2 Error"),
        ],
      });

      const secondary = new ReplayModel({
        modelId: PINNED_MODELS.GEMINI_3_6_FLASH,
        cannedResponses: [new Error("500 Chunk 2 Fallback Error")],
      });

      const tertiary = new ReplayModel({
        modelId: PINNED_MODELS.GROQ_GPT_OSS_120B,
        cannedResponses: [new Error("500 Chunk 2 Tertiary Error")],
      });

      const router = createIsolatedRouter(
        new Map([
          [PINNED_MODELS.GEMINI_3_5_FLASH_LITE, primary],
          [PINNED_MODELS.GEMINI_3_6_FLASH, secondary],
          [PINNED_MODELS.GROQ_GPT_OSS_120B, tertiary],
        ]),
      );

      const result = await executeAIReview(
        prisma,
        mockGithubClient as GitHubPullRequestClient,
        multiFilePrepared,
        { runId: "test-s6", config: aiConfig, modelRouter: router },
      );

      expect(result.status).toBe("PARTIAL");
      expect(result.summary.completedChunks).toBe(1);
      expect(result.summary.failedChunks).toBe(1);
      expect(result.validatedFindings).toHaveLength(1);
    });

    // Scenario 7: Malformed model JSON response
    it("Scenario 7: Malformed model JSON response triggers safe failover to next model", async () => {
      const prisma = createMockPrismaClient();
      const primary = new ReplayModel({
        modelId: PINNED_MODELS.GEMINI_3_5_FLASH_LITE,
        cannedResponses: [
          new Error(
            "JSON Parse error: Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON",
          ),
        ],
      });
      const secondary = new ReplayModel({
        modelId: PINNED_MODELS.GEMINI_3_6_FLASH,
        defaultFindings: [validFindingCandidate],
      });

      const router = createIsolatedRouter(
        new Map([
          [PINNED_MODELS.GEMINI_3_5_FLASH_LITE, primary],
          [PINNED_MODELS.GEMINI_3_6_FLASH, secondary],
        ]),
      );

      const result = await executeAIReview(
        prisma,
        mockGithubClient as GitHubPullRequestClient,
        basePrepared,
        { runId: "test-s7", config: aiConfig, modelRouter: router },
      );

      expect(result.status).toBe("COMPLETE");
      expect(result.summary.finalModel).toBe(PINNED_MODELS.GEMINI_3_6_FLASH);
      expect(result.validatedFindings).toHaveLength(1);
    });

    // Scenario 8: Invalid structured output schema
    it("Scenario 8: Invalid structured output schema fails over to healthy secondary model", async () => {
      const prisma = createMockPrismaClient();
      const primary = new ReplayModel({
        modelId: PINNED_MODELS.GEMINI_3_5_FLASH_LITE,
        cannedResponses: [
          new Error(
            "Schema validation failed: Required field 'evidence_quote' missing",
          ),
        ],
      });
      const secondary = new ReplayModel({
        modelId: PINNED_MODELS.GEMINI_3_6_FLASH,
        defaultFindings: [validFindingCandidate],
      });

      const router = createIsolatedRouter(
        new Map([
          [PINNED_MODELS.GEMINI_3_5_FLASH_LITE, primary],
          [PINNED_MODELS.GEMINI_3_6_FLASH, secondary],
        ]),
      );

      const result = await executeAIReview(
        prisma,
        mockGithubClient as GitHubPullRequestClient,
        basePrepared,
        { runId: "test-s8", config: aiConfig, modelRouter: router },
      );

      expect(result.status).toBe("COMPLETE");
      expect(result.summary.finalModel).toBe(PINNED_MODELS.GEMINI_3_6_FLASH);
      expect(result.validatedFindings).toHaveLength(1);
    });

    // Scenario 9: Clean empty findings array ({"findings": []})
    it("Scenario 9: Clean empty findings array completes with 0 findings and clean summary", async () => {
      const prisma = createMockPrismaClient();
      const primary = new ReplayModel({
        modelId: PINNED_MODELS.GEMINI_3_5_FLASH_LITE,
        defaultFindings: [],
      });

      const router = createIsolatedRouter(
        new Map([[PINNED_MODELS.GEMINI_3_5_FLASH_LITE, primary]]),
      );

      const result = await executeAIReview(
        prisma,
        mockGithubClient as GitHubPullRequestClient,
        basePrepared,
        { runId: "test-s9", config: aiConfig, modelRouter: router },
      );

      expect(result.status).toBe("COMPLETE");
      expect(result.validatedFindings).toHaveLength(0);
      expect(result.summary.candidatesGenerated).toBe(0);
      expect(result.summary.candidatesValidated).toBe(0);
    });

    // Scenario 10: Request timeout
    it("Scenario 10: Request timeout error fails over and recovers on secondary model", async () => {
      const prisma = createMockPrismaClient();
      const primary = new ReplayModel({
        modelId: PINNED_MODELS.GEMINI_3_5_FLASH_LITE,
        cannedResponses: [
          new Error("504 Gateway Timeout: upstream request exceeded 30000ms"),
          new Error("504 Gateway Timeout: retry timed out"),
        ],
      });
      const secondary = new ReplayModel({
        modelId: PINNED_MODELS.GEMINI_3_6_FLASH,
        defaultFindings: [validFindingCandidate],
      });

      const router = createIsolatedRouter(
        new Map([
          [PINNED_MODELS.GEMINI_3_5_FLASH_LITE, primary],
          [PINNED_MODELS.GEMINI_3_6_FLASH, secondary],
        ]),
      );

      const result = await executeAIReview(
        prisma,
        mockGithubClient as GitHubPullRequestClient,
        basePrepared,
        { runId: "test-s10", config: aiConfig, modelRouter: router },
      );

      expect(result.status).toBe("COMPLETE");
      expect(result.summary.finalModel).toBe(PINNED_MODELS.GEMINI_3_6_FLASH);
      expect(result.validatedFindings).toHaveLength(1);
    });

    // Scenario 11: Invalid credentials
    it("Scenario 11: Invalid credentials (401) classifies correctly and cascades without retry loop", async () => {
      const prisma = createMockPrismaClient();
      const primary = new ReplayModel({
        modelId: PINNED_MODELS.GEMINI_3_5_FLASH_LITE,
        cannedResponses: [
          new Error("401 Unauthorized: Invalid API Key provided"),
        ],
      });
      const secondary = new ReplayModel({
        modelId: PINNED_MODELS.GEMINI_3_6_FLASH,
        defaultFindings: [validFindingCandidate],
      });

      const router = createIsolatedRouter(
        new Map([
          [PINNED_MODELS.GEMINI_3_5_FLASH_LITE, primary],
          [PINNED_MODELS.GEMINI_3_6_FLASH, secondary],
        ]),
      );

      const result = await executeAIReview(
        prisma,
        mockGithubClient as GitHubPullRequestClient,
        basePrepared,
        { runId: "test-s11", config: aiConfig, modelRouter: router },
      );

      expect(result.status).toBe("COMPLETE");
      expect(result.summary.finalModel).toBe(PINNED_MODELS.GEMINI_3_6_FLASH);
      expect(result.validatedFindings).toHaveLength(1);
    });

    // Scenario 12: Quota exhaustion without infinite loops
    it("Scenario 12: Daily quota exhaustion on all models terminates cleanly without loop", async () => {
      const prisma = createMockPrismaClient();
      const primary = new ReplayModel({
        modelId: PINNED_MODELS.GEMINI_3_5_FLASH_LITE,
        cannedResponses: [
          new Error("429 Resource Exhausted: daily quota exceeded"),
        ],
      });
      const secondary = new ReplayModel({
        modelId: PINNED_MODELS.GEMINI_3_6_FLASH,
        cannedResponses: [
          new Error("429 Resource Exhausted: daily quota exceeded"),
        ],
      });
      const tertiary = new ReplayModel({
        modelId: PINNED_MODELS.GROQ_GPT_OSS_120B,
        cannedResponses: [
          new Error("429 Resource Exhausted: daily quota exceeded"),
        ],
      });

      const router = createIsolatedRouter(
        new Map([
          [PINNED_MODELS.GEMINI_3_5_FLASH_LITE, primary],
          [PINNED_MODELS.GEMINI_3_6_FLASH, secondary],
          [PINNED_MODELS.GROQ_GPT_OSS_120B, tertiary],
        ]),
      );

      const result = await executeAIReview(
        prisma,
        mockGithubClient as GitHubPullRequestClient,
        basePrepared,
        { runId: "test-s12", config: aiConfig, modelRouter: router },
      );

      expect(result.status).toBe("UNAVAILABLE");
      expect(prisma._storage.aiAttempts.size).toBe(3);
    });

    // Scenario 13: Telemetry persistence accuracy
    it("Scenario 13: Accurate telemetry logged per inference attempt in database", async () => {
      const prisma = createMockPrismaClient();
      const primary = new ReplayModel({
        modelId: PINNED_MODELS.GEMINI_3_5_FLASH_LITE,
        cannedResponses: [new Error("500 Internal Server Error")],
      });
      const secondary = new ReplayModel({
        modelId: PINNED_MODELS.GEMINI_3_6_FLASH,
        defaultFindings: [validFindingCandidate],
      });

      const router = createIsolatedRouter(
        new Map([
          [PINNED_MODELS.GEMINI_3_5_FLASH_LITE, primary],
          [PINNED_MODELS.GEMINI_3_6_FLASH, secondary],
        ]),
      );

      await executeAIReview(
        prisma,
        mockGithubClient as GitHubPullRequestClient,
        basePrepared,
        { runId: "test-s13", config: aiConfig, modelRouter: router },
      );

      const attempts = Array.from(prisma._storage.aiAttempts.values());
      expect(attempts).toHaveLength(2);

      // Attempt 1: Failed primary
      expect(attempts[0]!.attemptNumber).toBe(1);
      expect(attempts[0]!.modelId).toBe(PINNED_MODELS.GEMINI_3_5_FLASH_LITE);
      expect(attempts[0]!.status).toBe("error");
      expect(attempts[0]!.errorCategory).toBe("SERVER_ERROR");

      // Attempt 2: Succeeded secondary
      expect(attempts[1]!.attemptNumber).toBe(2);
      expect(attempts[1]!.modelId).toBe(PINNED_MODELS.GEMINI_3_6_FLASH);
      expect(attempts[1]!.status).toBe("success");
      expect(attempts[1]!.errorCategory).toBeNull();
    });

    // Scenario 14: Deduplication after fallback
    it("Scenario 14: Duplicate candidate findings across chunks or models are deduplicated", async () => {
      const prisma = createMockPrismaClient();
      const primary = new ReplayModel({
        modelId: PINNED_MODELS.GEMINI_3_5_FLASH_LITE,
        defaultFindings: [
          validFindingCandidate,
          { ...validFindingCandidate }, // identical duplicate
        ],
      });

      const router = createIsolatedRouter(
        new Map([[PINNED_MODELS.GEMINI_3_5_FLASH_LITE, primary]]),
      );

      const result = await executeAIReview(
        prisma,
        mockGithubClient as GitHubPullRequestClient,
        basePrepared,
        { runId: "test-s14", config: aiConfig, modelRouter: router },
      );

      // Validator validates both against diff lines, but deduplicateFindings collapses them
      expect(result.validatedFindings).toHaveLength(2);
      const deduped = deduplicateFindings(result.validatedFindings);
      expect(deduped).toHaveLength(1);
    });

    // Scenario 15: No unvalidated findings published
    it("Scenario 15: Rejects ungrounded or hallucinated candidate findings without publication", async () => {
      const prisma = createMockPrismaClient();
      const primary = new ReplayModel({
        modelId: PINNED_MODELS.GEMINI_3_5_FLASH_LITE,
        defaultFindings: [
          {
            ...validFindingCandidate,
            file_path: "src/non_existent_file.ts", // Hallucinated file
          },
          {
            ...validFindingCandidate,
            line: 9999, // Line not in diff
          },
          {
            ...validFindingCandidate,
            evidence_quote: "completely hallucinated code line", // Quote does not match
          },
        ],
      });

      const router = createIsolatedRouter(
        new Map([[PINNED_MODELS.GEMINI_3_5_FLASH_LITE, primary]]),
      );

      const result = await executeAIReview(
        prisma,
        mockGithubClient as GitHubPullRequestClient,
        basePrepared,
        { runId: "test-s15", config: aiConfig, modelRouter: router },
      );

      expect(result.status).toBe("COMPLETE");
      expect(result.validatedFindings).toHaveLength(0); // All 3 rejected by evidence gate
    });
  });
});
