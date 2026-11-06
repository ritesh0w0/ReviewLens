import { type RuleContext, type ValidatedFinding } from "@reviewlens/core";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { GitHubPullRequestClient } from "../github/pull-request-client.js";
import { buildRuleContext } from "../pipeline/rule-context-adapter.js";
import type { PreparedReviewInput } from "../pipeline/types.js";
import {
  AI_PROFILES,
  loadAIConfig,
  MODEL_OPERATING_BUDGETS,
  PINNED_MODELS,
  type AIConfig,
  type PinnedModelId,
} from "./config.js";
import {
  buildReviewUnits,
  packUnitsIntoChunks,
  type PackedChunk,
} from "./context/chunker.js";
import { fetchBoundedSources } from "./context/source-fetcher.js";
import { createModelRouter } from "./models/model-factory.js";
import { ModelRouter } from "./models/model-router.js";
import { checkPublicRepoGate } from "./security/public-repo-gate.js";
import { isSensitivePath } from "./security/sensitive-path-filter.js";
import { classifyAIError } from "./reliability/errors.js";
import type {
  AIChunkReviewRequest,
  AIChunkReviewResult,
  AIExecutionStatus,
  AIExecutionSummary,
  ReviewModel,
} from "./types.js";
import { validateAIChunkFindings } from "./validation/candidate-validator.js";

export interface AIOrchestratorOptions {
  runId: string;
  claimToken?: string;
  signal?: AbortSignal;
  config?: AIConfig;
  modelRouter?: ModelRouter;
  ruleContext?: RuleContext;
  confidenceThreshold?: number;
}

export interface AIOrchestratorResult {
  readonly status: AIExecutionStatus;
  readonly validatedFindings: readonly ValidatedFinding[];
  readonly summary: AIExecutionSummary;
  readonly coverageNotice?: string;
}

export async function executeAIReview(
  prisma: PrismaClient,
  githubClient: GitHubPullRequestClient,
  prepared: PreparedReviewInput,
  options: AIOrchestratorOptions,
): Promise<AIOrchestratorResult> {
  const config = options.config ?? loadAIConfig();
  const runId = options.runId;

  // 1. Check whether AI review is enabled and kill switch
  if (!config.enabled || config.killSwitch) {
    const reason = config.killSwitch
      ? "AI review disabled by kill switch"
      : "AI review is not enabled";

    await persistExecutionRecord(prisma, runId, {
      status: "NOT_ENABLED",
      profile: config.profile,
      primaryModel: AI_PROFILES[config.profile][0]!,
      failureReason: reason,
    });

    return {
      status: "NOT_ENABLED",
      validatedFindings: [],
      summary: createEmptySummary("NOT_ENABLED", config.profile, reason),
    };
  }

  // 2. Check Public Repository Gate
  const gateCheck = checkPublicRepoGate({
    isPrivate: prepared.repository.isPrivate,
    visibility: prepared.repository.visibility,
  });

  if (!gateCheck.eligible) {
    await persistExecutionRecord(prisma, runId, {
      status: "NOT_ELIGIBLE",
      profile: config.profile,
      primaryModel: AI_PROFILES[config.profile][0]!,
      failureReason: gateCheck.reason,
    });

    return {
      status: "NOT_ELIGIBLE",
      validatedFindings: [],
      summary: createEmptySummary(
        "NOT_ELIGIBLE",
        config.profile,
        gateCheck.reason,
      ),
      coverageNotice:
        "AI analysis skipped: repository is not confirmed public.",
    };
  }

  // 3. Check for eligible parsed diff files (sensitive paths excluded BEFORE source fetch)
  const eligibleFiles = prepared.files.filter(
    (f) =>
      f.parseStatus === "parsed" &&
      f.filterDecision.included &&
      (f.metadata.patch || (f.diff && f.diff.hunks.length > 0)) &&
      !isSensitivePath(f.metadata.path) &&
      (!f.metadata.previousPath || !isSensitivePath(f.metadata.previousPath)),
  );

  if (eligibleFiles.length === 0) {
    await persistExecutionRecord(prisma, runId, {
      status: "NOT_NEEDED",
      profile: config.profile,
      primaryModel: AI_PROFILES[config.profile][0]!,
      failureReason: "No eligible changed files with unified diffs",
    });

    return {
      status: "NOT_NEEDED",
      validatedFindings: [],
      summary: createEmptySummary(
        "NOT_NEEDED",
        config.profile,
        "No eligible files",
      ),
    };
  }

  // 4. Source-grounded context fetch
  const filePaths = eligibleFiles.map((f) => f.metadata.path);
  const boundedSources = await fetchBoundedSources(
    githubClient,
    prepared.repository.owner,
    prepared.repository.name,
    prepared.pullRequest.headSha,
    filePaths,
    options.signal,
  );

  // 5. Construct review units and initial chunk packing
  const units = buildReviewUnits(prepared, boundedSources.files);
  if (units.length === 0) {
    await persistExecutionRecord(prisma, runId, {
      status: "NOT_NEEDED",
      profile: config.profile,
      primaryModel: AI_PROFILES[config.profile][0]!,
      failureReason: "No reviewable units after security and path filtering",
    });

    return {
      status: "NOT_NEEDED",
      validatedFindings: [],
      summary: createEmptySummary(
        "NOT_NEEDED",
        config.profile,
        "No reviewable units",
      ),
    };
  }

  // Initialize router
  const router = options.modelRouter ?? createModelRouter(config);
  let activeModelId = router.getActiveModelId();
  const operatingBudget = MODEL_OPERATING_BUDGETS[activeModelId];

  let chunks: PackedChunk[] = packUnitsIntoChunks(
    units,
    operatingBudget.targetInputTokens,
  );

  // Check claim token before persisting execution
  if (options.claimToken) {
    const currentRun = await prisma.reviewRun.findUnique({
      where: { id: runId },
    });
    if (
      currentRun?.claimToken !== options.claimToken ||
      currentRun?.status !== "RUNNING"
    ) {
      return {
        status: "CANCELLED",
        validatedFindings: [],
        summary: createEmptySummary(
          "CANCELLED",
          config.profile,
          "Worker claim token lost before AI execution start",
        ),
      };
    }
  }

  // 6. Persist execution start in DB
  const execRecord = await persistExecutionRecord(prisma, runId, {
    status: "RUNNING",
    profile: config.profile,
    primaryModel: activeModelId,
    totalChunks: chunks.length,
  });

  // Query existing chunks for this execution to support safe resumption & recovery
  const existingChunks = await prisma.aIReviewChunk.findMany({
    where: { executionId: execRecord.id },
  });

  const existingCompletedChunkMap = new Map<
    number,
    (typeof existingChunks)[0]
  >();
  for (const ec of existingChunks) {
    if (ec.status === "COMPLETE") {
      existingCompletedChunkMap.set(ec.chunkIndex, ec);
    } else {
      // Mark orphaned in-flight attempts from crashed worker attempts
      await prisma.aIInferenceAttempt.updateMany({
        where: { chunkId: ec.id, status: "PENDING" },
        data: {
          status: "UNKNOWN",
          errorMessage: "Worker crashed or lost claim during previous attempt",
        },
      });
    }
  }

  const ruleContext = options.ruleContext ?? buildRuleContext(prepared);
  const repoFullName = `${prepared.repository.owner}/${prepared.repository.name}`;
  const allValidatedFindings: ValidatedFinding[] = [];

  let completedChunks = 0;
  let failedChunks = 0;
  let skippedChunks = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let candidatesGenerated = 0;
  let candidatesValidated = 0;
  let finalFailureReason: string | undefined;

  const MAX_BACKOFF_WAIT_MS = 15000;

  // 7. Execute Chunks
  let chainExhausted = false;

  for (let i = 0; i < chunks.length; i++) {
    if (options.signal?.aborted) {
      skippedChunks += chunks.length - i;
      break;
    }

    if (chainExhausted) {
      failedChunks += chunks.length - i;
      break;
    }

    const chunk = chunks[i]!;

    // Check worker claim token before chunk execution
    if (options.claimToken) {
      const currentRun = await prisma.reviewRun.findUnique({
        where: { id: runId },
      });
      if (
        currentRun?.claimToken !== options.claimToken ||
        currentRun?.status !== "RUNNING"
      ) {
        return {
          status: "CANCELLED",
          validatedFindings: allValidatedFindings,
          summary: createEmptySummary(
            "CANCELLED",
            config.profile,
            "Worker claim token lost during chunk processing",
          ),
        };
      }
    }

    // Resumption optimization: If chunk was already COMPLETE in DB, skip re-execution
    if (existingCompletedChunkMap.has(chunk.chunkIndex)) {
      const completedDbChunk = existingCompletedChunkMap.get(chunk.chunkIndex)!;
      completedChunks++;
      totalInputTokens += completedDbChunk.inputTokens;
      totalOutputTokens += completedDbChunk.outputTokens;
      continue;
    }

    // Persist chunk record initially with currently active model
    const chunkDb = await prisma.aIReviewChunk.create({
      data: {
        executionId: execRecord.id,
        chunkIndex: chunk.chunkIndex,
        filePaths: chunk.files.map((f) => f.path),
        modelId: router.getActiveModelId(),
        status: "PENDING",
      },
    });

    let attemptCount = 0;
    let chunkSucceeded = false;
    let lastResult: AIChunkReviewResult | undefined;
    let successfulRequest: AIChunkReviewRequest | undefined;

    while (!chunkSucceeded && !options.signal?.aborted) {
      activeModelId = router.getActiveModelId();
      const model = router.getActiveModel();

      if (!model) {
        // Model not registered or unavailable in this environment: try falling back
        const fb = router.fallback();
        if (fb.switched && fb.newModelId) {
          continue;
        }
        chainExhausted = true;
        break;
      }

      // Check circuit breaker and rate limiter for this model
      const availability = router.canUseModel(
        activeModelId,
        chunk.estimatedTokens,
      );
      if (!availability.usable) {
        // Model is blocked by rate limiter or circuit breaker: failover to next model
        const fb = router.fallback();
        if (fb.switched && fb.newModelId) {
          if (fb.newModelId === PINNED_MODELS.GROQ_GPT_OSS_120B) {
            const remainingUnits = chunks.slice(i).flatMap((c) => c.units);
            const repacked = packUnitsIntoChunks(
              remainingUnits,
              MODEL_OPERATING_BUDGETS[fb.newModelId].targetInputTokens,
            );
            chunks = [...chunks.slice(0, i), ...repacked];
          }
          continue; // Evaluate next model in fallback chain
        } else {
          lastResult = {
            status: "rate_limited",
            errorCategory: "RATE_LIMIT_RPM",
            errorMessage:
              availability.reason ?? "Model rate limited or circuit open",
            rawFindings: [],
            inputTokens: 0,
            outputTokens: 0,
            latencyMs: 0,
          };
          chainExhausted = true;
          break; // Fallback chain exhausted
        }
      }

      const request: AIChunkReviewRequest = {
        chunkIndex: chunk.chunkIndex,
        totalChunks: chunks.length,
        modelId: activeModelId,
        files: chunk.files,
        repositoryFullName: repoFullName,
        prNumber: prepared.pullRequest.number,
        headSha: prepared.pullRequest.headSha,
        baseSha: prepared.pullRequest.baseSha,
      };

      attemptCount++;
      let result: AIChunkReviewResult = await safeInvokeModel(
        model,
        request,
        options.signal,
      );
      lastResult = result;

      await prisma.aIInferenceAttempt.create({
        data: {
          chunkId: chunkDb.id,
          attemptNumber: attemptCount,
          modelId: activeModelId,
          provider: model.provider ?? "unknown",
          status: result.status,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          latencyMs: result.latencyMs,
          errorCategory: result.errorCategory,
          errorMessage: result.errorMessage,
        },
      });

      if (result.status === "success") {
        router.recordSuccess(activeModelId);
        chunkSucceeded = true;
        successfulRequest = request;
        break;
      }

      // Transient retry: max 1 retry with jitter for retryable RPM or timeout
      const canTransientRetry =
        result.errorCategory === "RATE_LIMIT_RPM" ||
        result.errorCategory === "TIMEOUT";

      if (canTransientRetry && !options.signal?.aborted) {
        const baseDelay = process.env.NODE_ENV === "test" ? 10 : 1000;
        const jitterMs = Math.min(
          baseDelay +
            Math.floor(
              Math.random() * (process.env.NODE_ENV === "test" ? 10 : 500),
            ),
          MAX_BACKOFF_WAIT_MS,
        );
        await new Promise((resolve) => setTimeout(resolve, jitterMs));

        if (!options.signal?.aborted) {
          attemptCount++;
          result = await safeInvokeModel(model, request, options.signal);
          lastResult = result;

          await prisma.aIInferenceAttempt.create({
            data: {
              chunkId: chunkDb.id,
              attemptNumber: attemptCount,
              modelId: activeModelId,
              provider: model.provider ?? "unknown",
              status: result.status,
              inputTokens: result.inputTokens,
              outputTokens: result.outputTokens,
              latencyMs: result.latencyMs,
              errorCategory: result.errorCategory,
              errorMessage: result.errorMessage,
            },
          });

          if (result.status === "success") {
            router.recordSuccess(activeModelId);
            chunkSucceeded = true;
            successfulRequest = request;
            break;
          }
        }
      }

      // Record failure on current model's circuit breaker
      router.recordFailure(activeModelId);

      // If abort signal triggered or non-recoverable safety refusal, do not fall back
      if (
        options.signal?.aborted ||
        result.errorCategory === "SAFETY_REFUSAL"
      ) {
        break;
      }

      // Fallback: switch to next model in profile chain
      const fb = router.fallback();
      if (fb.switched && fb.newModelId) {
        if (fb.newModelId === PINNED_MODELS.GROQ_GPT_OSS_120B) {
          const remainingUnits = chunks.slice(i).flatMap((c) => c.units);
          const repacked = packUnitsIntoChunks(
            remainingUnits,
            MODEL_OPERATING_BUDGETS[fb.newModelId].targetInputTokens,
          );
          chunks = [...chunks.slice(0, i), ...repacked];
        }
      } else {
        // Fallback chain exhausted
        chainExhausted = true;
        break;
      }
    }

    // Process chunk result
    if (
      chunkSucceeded &&
      lastResult?.status === "success" &&
      successfulRequest
    ) {
      completedChunks++;
      totalInputTokens += lastResult.inputTokens;
      totalOutputTokens += lastResult.outputTokens;
      candidatesGenerated += lastResult.rawFindings.length;

      // Validate through 7-stage pipeline
      const validation = validateAIChunkFindings(
        successfulRequest,
        lastResult,
        ruleContext,
        {
          repoIdentifier: repoFullName,
        },
      );

      for (const d of validation.diagnostics) {
        if (!d.accepted) {
          console.log(`[Validation Rejection] reason="${d.rejectionReason}"`);
        } else {
          console.log(
            `[Validation Acceptance] candidate accepted: line=${d.candidate?.primaryEvidence.kind === "code_line" ? d.candidate.primaryEvidence.line : "?"}`,
          );
        }
      }

      candidatesValidated += validation.acceptedCandidates;
      allValidatedFindings.push(...validation.validatedFindings);

      await prisma.aIReviewChunk.update({
        where: { id: chunkDb.id },
        data: {
          modelId: successfulRequest.modelId,
          status: "COMPLETE",
          inputTokens: lastResult.inputTokens,
          outputTokens: lastResult.outputTokens,
          completedAt: new Date(),
        },
      });
    } else {
      failedChunks++;
      finalFailureReason =
        lastResult?.errorMessage ?? "AI chunk execution failed";
      await prisma.aIReviewChunk.update({
        where: { id: chunkDb.id },
        data: {
          modelId: router.getActiveModelId(),
          status: "FAILED",
          error: finalFailureReason,
          completedAt: new Date(),
        },
      });
    }
  }

  // 8. Determine final execution status
  let finalStatus: AIExecutionStatus;
  if (options.signal?.aborted) {
    finalStatus = "CANCELLED";
  } else if (completedChunks === chunks.length && chunks.length > 0) {
    finalStatus = "COMPLETE";
  } else if (completedChunks > 0 && failedChunks > 0) {
    finalStatus = "PARTIAL";
  } else if (completedChunks === 0 && failedChunks > 0) {
    finalStatus = "UNAVAILABLE";
  } else {
    finalStatus = "NOT_NEEDED";
  }

  const finalModel = router.getActiveModelId();

  // Check worker claim token before final DB persistence
  if (options.claimToken) {
    const currentRun = await prisma.reviewRun.findUnique({
      where: { id: runId },
    });
    if (
      currentRun?.claimToken !== options.claimToken ||
      currentRun?.status !== "RUNNING"
    ) {
      return {
        status: "CANCELLED",
        validatedFindings: allValidatedFindings,
        summary: createEmptySummary(
          "CANCELLED",
          config.profile,
          "Worker claim token lost before final persistence",
        ),
      };
    }
  }

  // 9. Update execution in DB
  await prisma.aIReviewExecution.update({
    where: { id: execRecord.id },
    data: {
      status: finalStatus,
      finalModel,
      totalChunks: chunks.length,
      completedChunks,
      failedChunks,
      skippedChunks,
      totalInputTokens,
      totalOutputTokens,
      totalCandidatesGenerated: candidatesGenerated,
      totalCandidatesValidated: candidatesValidated,
      failureReason: finalFailureReason,
      completedAt: new Date(),
    },
  });

  // Update ReviewRun token aggregates
  await prisma.reviewRun.updateMany({
    where: { id: runId },
    data: {
      tokensIn: totalInputTokens,
      tokensOut: totalOutputTokens,
    },
  });

  const summary: AIExecutionSummary = {
    status: finalStatus,
    primaryModel: AI_PROFILES[config.profile][0]!,
    finalModel,
    totalChunks: chunks.length,
    completedChunks,
    failedChunks,
    skippedChunks,
    totalInputTokens,
    totalOutputTokens,
    candidatesGenerated,
    candidatesValidated,
    failureReason: finalFailureReason,
  };

  const coverageNotice = formatCoverageNotice(summary);

  return {
    status: finalStatus,
    validatedFindings: allValidatedFindings,
    summary,
    coverageNotice,
  };
}

async function persistExecutionRecord(
  prisma: PrismaClient,
  runId: string,
  data: {
    status: AIExecutionStatus;
    profile: string;
    primaryModel: string;
    totalChunks?: number;
    failureReason?: string;
  },
) {
  return prisma.aIReviewExecution.upsert({
    where: { reviewRunId: runId },
    create: {
      reviewRunId: runId,
      status: data.status,
      profile: data.profile,
      primaryModel: data.primaryModel,
      totalChunks: data.totalChunks ?? 0,
      failureReason: data.failureReason,
    },
    update: {
      status: data.status,
      totalChunks: data.totalChunks ?? 0,
      failureReason: data.failureReason,
    },
  });
}

function createEmptySummary(
  status: AIExecutionStatus,
  profile: string,
  reason?: string,
): AIExecutionSummary {
  return {
    status,
    primaryModel:
      AI_PROFILES[profile as keyof typeof AI_PROFILES]?.[0] ??
      ("gemini-3.5-flash-lite" as PinnedModelId),
    totalChunks: 0,
    completedChunks: 0,
    failedChunks: 0,
    skippedChunks: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    candidatesGenerated: 0,
    candidatesValidated: 0,
    failureReason: reason,
  };
}

function formatCoverageNotice(summary: AIExecutionSummary): string | undefined {
  if (summary.status === "COMPLETE") {
    return `AI review: ${summary.completedChunks} chunk(s) analyzed using ${summary.finalModel ?? summary.primaryModel}. ${summary.candidatesValidated} candidate finding(s) validated against code changes.`;
  }
  if (summary.status === "PARTIAL") {
    return `AI review: Partial coverage (${summary.completedChunks}/${summary.totalChunks} chunks analyzed) using ${summary.finalModel ?? summary.primaryModel}.`;
  }
  if (summary.status === "UNAVAILABLE") {
    return "AI review was unavailable during this run (rate limits or provider outage). Review completed using deterministic rules.";
  }
  return undefined;
}

async function safeInvokeModel(
  model: ReviewModel,
  request: AIChunkReviewRequest,
  signal?: AbortSignal,
): Promise<AIChunkReviewResult> {
  const start = Date.now();
  // Bound each inference attempt to a strict 25s timeout to prevent unhandled provider hangs
  const timeoutSignal = AbortSignal.timeout(25000);
  const effectiveSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;
  try {
    return await model.invokeChunkReview(request, effectiveSignal);
  } catch (err: unknown) {
    const latencyMs = Date.now() - start;
    const classified = classifyAIError(err);
    return {
      status:
        classified.category === "RATE_LIMIT_RPM" ||
        classified.category === "RATE_LIMIT_RPD"
          ? "rate_limited"
          : classified.category === "TIMEOUT"
            ? "timeout"
            : classified.category === "SAFETY_REFUSAL"
              ? "refusal"
              : "error",
      rawFindings: [],
      inputTokens: 0,
      outputTokens: 0,
      latencyMs,
      errorCategory: classified.category,
      errorMessage: classified.message,
    };
  }
}
