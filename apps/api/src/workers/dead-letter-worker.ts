import type { PgBoss, Job } from "pg-boss";
import { ReviewStatus, type PrismaClient } from "../generated/prisma/client.js";
import { QUEUE_REVIEW_PR_DLQ } from "../queue/queues.js";
import { reviewJobPayloadSchema } from "../queue/job-schemas.js";

export async function registerDeadLetterWorker(
  boss: PgBoss,
  prisma: PrismaClient,
): Promise<string> {
  return await boss.work(
    QUEUE_REVIEW_PR_DLQ,
    {
      teamSize: 1,
      teamConcurrency: 1,
      batchSize: 1,
      pollingIntervalSeconds: 0.5,
      notifyPollingIntervalSeconds: 0.5,
    },
    async (jobs: Job<unknown>[]) => {
      const job = jobs[0];
      if (!job) return;

      const parsed = reviewJobPayloadSchema.safeParse(job.data);
      if (!parsed.success) {
        return;
      }

      const { runId } = parsed.data;

      // Find run; if not already in terminal state, record terminal failure
      const run = await prisma.reviewRun.findUnique({
        where: { id: runId },
      });

      if (!run) return;

      const terminalStatuses: ReviewStatus[] = [
        ReviewStatus.SUCCEEDED,
        ReviewStatus.DEGRADED,
        ReviewStatus.FAILED,
        ReviewStatus.SUPERSEDED,
        ReviewStatus.SKIPPED,
      ];

      if (!terminalStatuses.includes(run.status)) {
        await prisma.reviewRun.update({
          where: { id: runId },
          data: {
            status: ReviewStatus.FAILED,
            failureReason: "Job exhausted retry limit and moved to DLQ",
            finishedAt: new Date(),
          },
        });
      }
    },
  );
}
