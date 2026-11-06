import { randomUUID } from "node:crypto";
import type { PgBoss, Job } from "pg-boss";
import { ReviewStatus, type PrismaClient } from "../generated/prisma/client.js";
import { QUEUE_REVIEW_PR } from "../queue/queues.js";
import { reviewJobPayloadSchema } from "../queue/job-schemas.js";
import { processReviewJob, claimReviewRun } from "./review-processor.js";
import type { GitHubPullRequestClient } from "../github/pull-request-client.js";
import { classifyError, PermanentError } from "./errors.js";

export interface ReviewWorkerOptions {
  githubClient?: GitHubPullRequestClient;
  concurrency?: number;
  publishReview?: boolean;
}

export async function registerReviewWorker(
  boss: PgBoss,
  prisma: PrismaClient,
  options: ReviewWorkerOptions = {},
): Promise<string> {
  return await boss.work(
    QUEUE_REVIEW_PR,
    {
      teamSize: options.concurrency ?? 1,
      teamConcurrency: options.concurrency ?? 1,
      batchSize: 1,
      pollingIntervalSeconds: 0.5,
      notifyPollingIntervalSeconds: 0.5,
    },
    async (jobs: Job<unknown>[]) => {
      const job = jobs[0];
      if (!job) return;

      // 1. Validate payload with Zod
      const parsed = reviewJobPayloadSchema.safeParse(job.data);
      if (!parsed.success) {
        throw new PermanentError(
          `Invalid review job payload: ${JSON.stringify(parsed.error.format())}`,
        );
      }

      const { runId } = parsed.data;
      const claimToken = randomUUID();
      const attempt = (job.retryCount ?? 0) + 1;

      // 2. Conditionally claim the ReviewRun atomically
      const claimed = await claimReviewRun(prisma, runId, attempt, claimToken);

      if (!claimed) {
        // Run is already terminal or claimed by another worker attempt
        return;
      }

      // 3. Process the review job
      try {
        await processReviewJob(prisma, runId, {
          claimToken,
          attempt,
          signal: (job as unknown as { signal?: AbortSignal }).signal,
          githubClient: options.githubClient,
          publishReview: options.publishReview,
        });
      } catch (err) {
        const classified = classifyError(err);
        if (!classified.isTransient) {
          // Permanent failure: mark ReviewRun FAILED and avoid unnecessary retries
          await prisma.reviewRun.updateMany({
            where: { id: runId, claimToken },
            data: {
              status: ReviewStatus.FAILED,
              failureReason: classified.message.slice(0, 500),
              finishedAt: new Date(),
            },
          });
          return;
        }

        // Transient error: rethrow to trigger configured backoff retry
        throw err;
      }
    },
  );
}
