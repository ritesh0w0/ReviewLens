import { randomUUID } from "node:crypto";
import {
  InstallationStatus,
  ReviewStatus,
  type PrismaClient,
} from "../generated/prisma/client.js";
import { type GitHubPullRequestClient } from "../github/pull-request-client.js";
import { OctokitPullRequestClient } from "../github/app-client.js";
import {
  isAmbiguousNetworkError,
  isInlineCoordinate422Error,
  PermanentError,
} from "./errors.js";
import {
  PullRequestDiffPipeline,
  StaleRevisionError,
  ClosedPullRequestError,
  PipelineResourceLimitError,
  IncompleteRetrievalError,
  type PreparedReviewInput,
} from "../pipeline/index.js";
import {
  evaluatePullRequestReview,
  EvidenceValidationError,
  PermanentConfigurationError,
  type ReviewOrchestratorResult,
} from "../review/review-orchestrator.js";
import { buildReviewPayload } from "../review/payload-builder.js";
import { reconcileReviewMarker } from "../review/marker-reconciliation.js";
import {
  executeAIReview,
  type AIOrchestratorResult,
} from "../ai/orchestrator.js";
import type { AIConfig } from "../ai/config.js";
import type { ModelRouter } from "../ai/models/model-router.js";

export interface ProcessReviewJobOptions {
  claimToken: string;
  attempt: number;
  signal?: AbortSignal;
  githubClient?: GitHubPullRequestClient;
  pipeline?: PullRequestDiffPipeline;
  publishReview?: boolean;
  aiConfig?: AIConfig;
  modelRouter?: ModelRouter;
}

export type ReviewProcessResult = {
  status: ReviewStatus;
  skipped?: boolean;
  recovered?: boolean;
  aborted?: boolean;
  githubReviewId?: number | bigint;
  reason?: string;
  preparedInput?: PreparedReviewInput;
  evalResult?: ReviewOrchestratorResult;
  aiResult?: AIOrchestratorResult;
};

export async function claimReviewRun(
  prisma: PrismaClient,
  runId: string,
  attempt: number,
  claimToken: string = randomUUID(),
): Promise<string | null> {
  const result = await prisma.reviewRun.updateMany({
    where: {
      id: runId,
      OR: [
        { status: ReviewStatus.QUEUED },
        {
          status: ReviewStatus.RUNNING,
          attemptCount: { lt: attempt },
        },
      ],
    },
    data: {
      status: ReviewStatus.RUNNING,
      claimToken,
      attemptCount: attempt,
      lastAttemptAt: new Date(),
    },
  });

  return result.count > 0 ? claimToken : null;
}

export async function processReviewJob(
  prisma: PrismaClient,
  runId: string,
  options: ProcessReviewJobOptions,
): Promise<ReviewProcessResult> {
  const run = await prisma.reviewRun.findUnique({
    where: { id: runId },
    include: {
      repository: {
        include: {
          installation: true,
        },
      },
    },
  });

  if (!run) {
    throw new PermanentError(`ReviewRun ${runId} not found in database`);
  }

  // 1. Skip terminal states
  const terminalStatuses: ReviewStatus[] = [
    ReviewStatus.SUCCEEDED,
    ReviewStatus.DEGRADED,
    ReviewStatus.FAILED,
    ReviewStatus.SUPERSEDED,
    ReviewStatus.SKIPPED,
  ];

  if (terminalStatuses.includes(run.status)) {
    return {
      status: run.status,
      skipped: true,
      reason: "ReviewRun is already in a terminal state",
    };
  }

  // Ensure this attempt holds the claim token in the database
  if (run.claimToken !== options.claimToken) {
    const claimed = await claimReviewRun(
      prisma,
      runId,
      options.attempt,
      options.claimToken,
    );
    if (!claimed) {
      return {
        status: run.status,
        skipped: true,
        reason: "Failed to acquire claim token on ReviewRun",
      };
    }
  }

  // 2. Verify installation and repository eligibility
  if (run.repository.installation.status !== InstallationStatus.ACTIVE) {
    await prisma.reviewRun.updateMany({
      where: { id: runId, claimToken: options.claimToken },
      data: {
        status: ReviewStatus.SKIPPED,
        degradedReason: `Installation is ${run.repository.installation.status}`,
        finishedAt: new Date(),
      },
    });
    return {
      status: ReviewStatus.SKIPPED,
      skipped: true,
      reason: `Installation is ${run.repository.installation.status}`,
    };
  }

  if (!run.repository.enabled) {
    await prisma.reviewRun.updateMany({
      where: { id: runId, claimToken: options.claimToken },
      data: {
        status: ReviewStatus.SKIPPED,
        degradedReason: "Repository is disabled",
        finishedAt: new Date(),
      },
    });
    return {
      status: ReviewStatus.SKIPPED,
      skipped: true,
      reason: "Repository is disabled",
    };
  }

  if (options.signal?.aborted) {
    return { status: run.status, aborted: true };
  }

  // 3. Resolve GitHub client
  let githubClient = options.githubClient;
  if (!githubClient) {
    const appId = process.env.GITHUB_APP_ID;
    const privateKey = process.env.GITHUB_PRIVATE_KEY;

    if (!appId || !privateKey) {
      throw new PermanentError(
        "GitHub App credentials (GITHUB_APP_ID, GITHUB_PRIVATE_KEY) are not configured",
      );
    }

    githubClient = new OctokitPullRequestClient({
      appId,
      privateKey,
      installationId: run.repository.installation.githubInstallationId,
      repositoryGithubId: run.repository.githubRepoId,
    });
  }

  const [owner, repoName] = run.repository.fullName.split("/");
  if (!owner || !repoName) {
    throw new PermanentError(
      `Invalid repository full name format: ${run.repository.fullName}`,
    );
  }

  // 4. MANDATORY RECONCILIATION: Check GitHub review marker BEFORE M2 preparation
  const initialReconcile = await reconcileReviewMarker(
    githubClient,
    owner,
    repoName,
    run.prNumber,
    run.headSha,
    runId,
    options.signal,
  );

  if (initialReconcile.outcome === "recovered") {
    await prisma.reviewRun.updateMany({
      where: { id: runId, claimToken: options.claimToken },
      data: {
        status: ReviewStatus.SUCCEEDED,
        githubReviewId: BigInt(initialReconcile.review.id),
        finishedAt: new Date(),
      },
    });

    return {
      status: ReviewStatus.SUCCEEDED,
      recovered: true,
      githubReviewId: initialReconcile.review.id,
    };
  }

  if (initialReconcile.outcome === "commit_sha_mismatch") {
    const msg = `Publication integrity anomaly: App-authored review found with marker ${runId} but different commit SHA ${initialReconcile.review.commit_id} (expected ${run.headSha})`;
    await prisma.reviewRun.updateMany({
      where: { id: runId, claimToken: options.claimToken },
      data: {
        status: ReviewStatus.FAILED,
        failureReason: msg,
        finishedAt: new Date(),
      },
    });
    throw new PermanentError(msg);
  }

  if (initialReconcile.outcome === "multiple_valid_markers") {
    const msg = `Publication integrity anomaly: Multiple App-authored reviews found with marker ${runId}`;
    await prisma.reviewRun.updateMany({
      where: { id: runId, claimToken: options.claimToken },
      data: {
        status: ReviewStatus.FAILED,
        failureReason: msg,
        finishedAt: new Date(),
      },
    });
    throw new PermanentError(msg);
  }

  if (initialReconcile.outcome === "pending_marker_conflict") {
    const msg = `Publication integrity anomaly: An unresolved PENDING review exists containing marker ${runId}`;
    await prisma.reviewRun.updateMany({
      where: { id: runId, claimToken: options.claimToken },
      data: {
        status: ReviewStatus.FAILED,
        failureReason: msg,
        finishedAt: new Date(),
      },
    });
    throw new PermanentError(msg);
  }

  // 5. Execute M2 Pull Request Diff Pipeline
  const pipeline =
    options.pipeline ?? new PullRequestDiffPipeline(githubClient);
  let preparedInput: PreparedReviewInput;

  try {
    preparedInput = await pipeline.prepare({
      owner,
      repo: repoName,
      prNumber: run.prNumber,
      expectedHeadSha: run.headSha,
      expectedBaseSha: run.baseSha,
      signal: options.signal,
    });
  } catch (err: unknown) {
    if (err instanceof StaleRevisionError) {
      await prisma.reviewRun.updateMany({
        where: { id: runId, claimToken: options.claimToken },
        data: {
          status: ReviewStatus.SUPERSEDED,
          degradedReason: `${err.message} (superseded)`,
          finishedAt: new Date(),
        },
      });
      return {
        status: ReviewStatus.SUPERSEDED,
        skipped: true,
        reason: err.message,
      };
    }

    if (err instanceof ClosedPullRequestError) {
      await prisma.reviewRun.updateMany({
        where: { id: runId, claimToken: options.claimToken },
        data: {
          status: ReviewStatus.SKIPPED,
          degradedReason: err.message,
          finishedAt: new Date(),
        },
      });
      return {
        status: ReviewStatus.SKIPPED,
        skipped: true,
        reason: err.message,
      };
    }

    if (
      err instanceof PipelineResourceLimitError ||
      err instanceof IncompleteRetrievalError
    ) {
      await prisma.reviewRun.updateMany({
        where: { id: runId, claimToken: options.claimToken },
        data: {
          status: ReviewStatus.FAILED,
          failureReason: err.message,
          finishedAt: new Date(),
        },
      });
      return {
        status: ReviewStatus.FAILED,
        reason: err.message,
      };
    }

    throw err;
  }

  const filesTotal = preparedInput.completeness.receivedFileCount;
  const filesReviewed = preparedInput.files.filter(
    (f) => f.parseStatus === "parsed",
  ).length;

  // 6. M3 deterministic rule evaluation (fail-closed if evidence integrity fails or config invalid)
  let evalResult: ReviewOrchestratorResult;
  try {
    evalResult = evaluatePullRequestReview(preparedInput, {
      runId,
    });
  } catch (err: unknown) {
    if (
      err instanceof PermanentConfigurationError ||
      err instanceof EvidenceValidationError
    ) {
      await prisma.reviewRun.updateMany({
        where: { id: runId, claimToken: options.claimToken },
        data: {
          status: ReviewStatus.FAILED,
          failureReason: err.message,
          finishedAt: new Date(),
        },
      });
      return {
        status: ReviewStatus.FAILED,
        reason: err.message,
      };
    }
    throw err;
  }

  // 7. Execute AI Review Orchestrator ONLY after deterministic evaluation succeeds
  let aiResult: AIOrchestratorResult | undefined;
  try {
    aiResult = await executeAIReview(prisma, githubClient, preparedInput, {
      runId,
      claimToken: options.claimToken,
      signal: options.signal,
      config: options.aiConfig,
      modelRouter: options.modelRouter,
    });
  } catch {
    // AI execution failure is non-fatal: pipeline gracefully continues with deterministic rules
  }

  // 8. Reconcile findings & presentation plan if AI findings or coverage notice exist
  if (aiResult?.validatedFindings?.length || aiResult?.coverageNotice) {
    try {
      evalResult = evaluatePullRequestReview(preparedInput, {
        runId,
        additionalFindings: aiResult.validatedFindings,
        aiCoverageNotice: aiResult.coverageNotice,
      });
    } catch {
      // Retain pure deterministic evaluation if merging encounters unexpected error
    }
  }

  // 8.1 Persist validated findings for dashboard visibility and inspection
  if (evalResult.validatedFindings.length > 0) {
    try {
      const findingRecords = evalResult.validatedFindings.map((f) => {
        let filePath: string | null = null;
        let line: number | null = null;
        let side: string | null = null;

        if (f.primaryEvidence.kind === "code_line") {
          filePath = f.primaryEvidence.path;
          line = f.primaryEvidence.line;
          side = f.primaryEvidence.side;
        } else if (f.primaryEvidence.kind === "file_relationship") {
          filePath = f.primaryEvidence.sourcePath;
        }

        const isAi = f.origin.kind === "ai_model";
        const ruleId = !isAi && "ruleId" in f.origin ? f.origin.ruleId : null;
        const modelId =
          isAi && "detectorId" in f.origin ? f.origin.detectorId : null;

        return {
          reviewRunId: runId,
          fingerprint: f.fingerprint,
          provenance: isAi ? "ai" : "deterministic",
          ruleId,
          modelId,
          category: f.code,
          severity: f.severity.toUpperCase(),
          title: f.title,
          description: f.message,
          recommendation: f.message,
          confidence: f.confidence != null ? f.confidence : null,
          filePath,
          line,
          side,
          scope: f.scope,
        };
      });

      await prisma.reviewFinding.createMany({
        data: findingRecords,
        skipDuplicates: true,
      });
    } catch (persistErr) {
      console.warn("Failed to persist review findings to database", persistErr);
    }
  }

  const postedCount =
    evalResult.plan.inlineGroups.flatMap((g) => g.findings).length +
    evalResult.plan.summaryFindings.length;

  // 9. Decide review publishing necessity
  if (!evalResult.hasReviewToPublish && !options.publishReview) {
    // Zero findings with complete coverage OR no rules configured:
    // Update ReviewRun directly to SUCCEEDED with githubReviewId = null (no empty review posted)
    await prisma.reviewRun.updateMany({
      where: { id: runId, claimToken: options.claimToken },
      data: {
        status: ReviewStatus.SUCCEEDED,
        filesTotal,
        filesReviewed,
        candidateCount: evalResult.findingsCount,
        postedCount: 0,
        githubReviewId: null,
        finishedAt: new Date(),
      },
    });

    return {
      status: ReviewStatus.SUCCEEDED,
      githubReviewId: undefined,
      preparedInput,
      evalResult,
      aiResult,
    };
  }

  // 8. Review Publication Workflow (Findings detected, partial coverage warning, or explicitly requested)
  // Re-verify PR freshness immediately before publishing
  const prePostPr = await githubClient.getPullRequest(
    owner,
    repoName,
    run.prNumber,
    { signal: options.signal },
  );

  if (prePostPr.state !== "open") {
    await prisma.reviewRun.updateMany({
      where: { id: runId, claimToken: options.claimToken },
      data: {
        status: ReviewStatus.SKIPPED,
        degradedReason: `Pull request #${run.prNumber} closed before review publication`,
        finishedAt: new Date(),
      },
    });
    return {
      status: ReviewStatus.SKIPPED,
      skipped: true,
      reason: `Pull request #${run.prNumber} closed before review publication`,
    };
  }

  if (prePostPr.headSha !== run.headSha || prePostPr.baseSha !== run.baseSha) {
    const msg = `Pull request revision changed before review publication (expected ${run.headSha.slice(0, 7)}, current is ${prePostPr.headSha.slice(0, 7)})`;
    await prisma.reviewRun.updateMany({
      where: { id: runId, claimToken: options.claimToken },
      data: {
        status: ReviewStatus.SUPERSEDED,
        degradedReason: msg,
        finishedAt: new Date(),
      },
    });
    return {
      status: ReviewStatus.SUPERSEDED,
      skipped: true,
      reason: msg,
    };
  }

  // Verify worker claim token still held
  const currentRun = await prisma.reviewRun.findUnique({
    where: { id: runId },
  });
  if (
    currentRun?.claimToken !== options.claimToken ||
    currentRun?.status !== ReviewStatus.RUNNING
  ) {
    return {
      status: currentRun?.status ?? ReviewStatus.RUNNING,
      aborted: true,
      reason: "Worker claim token lost before review publication",
    };
  }

  // MANDATORY: Reconcile marker AGAIN immediately before POST
  const prePostReconcile = await reconcileReviewMarker(
    githubClient,
    owner,
    repoName,
    run.prNumber,
    run.headSha,
    runId,
    options.signal,
  );

  if (prePostReconcile.outcome === "recovered") {
    await prisma.reviewRun.updateMany({
      where: { id: runId, claimToken: options.claimToken },
      data: {
        status: ReviewStatus.SUCCEEDED,
        filesTotal,
        filesReviewed,
        githubReviewId: BigInt(prePostReconcile.review.id),
        finishedAt: new Date(),
      },
    });

    return {
      status: ReviewStatus.SUCCEEDED,
      recovered: true,
      githubReviewId: prePostReconcile.review.id,
      preparedInput,
      evalResult,
      aiResult,
    };
  }

  // POST Batched Review
  let githubReviewId: number | undefined;
  const payload =
    evalResult.payload ??
    buildReviewPayload({
      runId,
      plan: evalResult.plan,
      overallCoverage: evalResult.overallCoverage,
      coverageWarnings: evalResult.warnings,
      repoName,
    });

  try {
    const created = await githubClient.createReview(
      owner,
      repoName,
      run.prNumber,
      {
        commitSha: run.headSha,
        body: payload.summaryBody,
        event: "COMMENT",
        comments: payload.comments,
      },
      { signal: options.signal },
    );
    githubReviewId = created.id;
  } catch (postErr: unknown) {
    if (isInlineCoordinate422Error(postErr)) {
      // Controlled one-time 422 fallback to summary-only review!
      // Re-verify freshness & claim
      const fbPr = await githubClient.getPullRequest(
        owner,
        repoName,
        run.prNumber,
        { signal: options.signal },
      );
      if (
        fbPr.state !== "open" ||
        fbPr.headSha !== run.headSha ||
        fbPr.baseSha !== run.baseSha
      ) {
        throw new StaleRevisionError(
          "Pull request revision changed during 422 fallback",
        );
      }

      const fbRun = await prisma.reviewRun.findUnique({
        where: { id: runId },
      });
      if (fbRun?.claimToken !== options.claimToken) {
        return {
          status: fbRun?.status ?? ReviewStatus.RUNNING,
          aborted: true,
          reason: "Claim lost during 422 fallback",
        };
      }

      // Reconcile marker once more
      const fbReconcile = await reconcileReviewMarker(
        githubClient,
        owner,
        repoName,
        run.prNumber,
        run.headSha,
        runId,
        options.signal,
      );

      if (fbReconcile.outcome === "recovered") {
        githubReviewId = fbReconcile.review.id;
      } else {
        // Send summary-only review
        const fallbackSummaryPayload = buildReviewPayload({
          runId,
          plan: {
            inlineGroups: [],
            summaryFindings: [
              ...evalResult.plan.summaryFindings,
              ...evalResult.plan.inlineGroups.flatMap((g) => g.findings),
            ],
            suppressedFindings: evalResult.plan.suppressedFindings,
            decisions: evalResult.plan.decisions,
            omittedInlineGroupsCount: evalResult.plan.inlineGroups.length,
            omittedInlineFindingsCount:
              evalResult.plan.omittedInlineFindingsCount,
          },
          overallCoverage: evalResult.overallCoverage,
          coverageWarnings: [
            ...evalResult.warnings,
            "Inline comments were rejected by GitHub coordinate validation; all findings presented in summary.",
          ],
          repoName,
        });

        const fbCreated = await githubClient.createReview(
          owner,
          repoName,
          run.prNumber,
          {
            commitSha: run.headSha,
            body: fallbackSummaryPayload.summaryBody,
            event: "COMMENT",
            comments: [],
          },
          { signal: options.signal },
        );
        githubReviewId = fbCreated.id;
      }
    } else if (isAmbiguousNetworkError(postErr)) {
      // Ambiguous network failure: check if marker review actually reached GitHub
      const ambReconcile = await reconcileReviewMarker(
        githubClient,
        owner,
        repoName,
        run.prNumber,
        run.headSha,
        runId,
        options.signal,
      );

      if (ambReconcile.outcome === "recovered") {
        githubReviewId = ambReconcile.review.id;
      } else {
        throw postErr; // Rethrow to trigger worker retry which starts with marker reconciliation
      }
    } else {
      throw postErr;
    }
  }

  // 9. Conditional atomic update with claim token check
  const updateResult = await prisma.reviewRun.updateMany({
    where: {
      id: runId,
      claimToken: options.claimToken,
    },
    data: {
      status: ReviewStatus.SUCCEEDED,
      filesTotal,
      filesReviewed,
      candidateCount: evalResult.findingsCount,
      postedCount,
      githubReviewId: githubReviewId ? BigInt(githubReviewId) : null,
      finishedAt: new Date(),
    },
  });

  if (updateResult.count === 0) {
    console.warn(
      `Warning: Stale claim token for ReviewRun ${runId}. State was not updated by this attempt.`,
    );
  }

  return {
    status: ReviewStatus.SUCCEEDED,
    githubReviewId,
    preparedInput,
    evalResult,
    aiResult,
  };
}
