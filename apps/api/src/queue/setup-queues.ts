import type { PgBoss } from "pg-boss";
import { QUEUE_REVIEW_PR, QUEUE_REVIEW_PR_DLQ } from "./queues.js";
import { getQueueConfig } from "./config.js";

export async function ensureQueues(boss: PgBoss): Promise<void> {
  const config = getQueueConfig();

  // 1. Dead-letter queue must exist before the main queue references it
  await boss.createQueue(QUEUE_REVIEW_PR_DLQ, {
    policy: "standard",
    retryLimit: 0,
    retentionSeconds: config.retentionSeconds,
  });

  // 2. Main review queue configured with retries, backoff, and dead-letter redirection
  await boss.createQueue(QUEUE_REVIEW_PR, {
    policy: "standard",
    retryLimit: config.retryLimit,
    retryDelay: config.retryDelay,
    retryBackoff: config.retryBackoff,
    expireInSeconds: config.expireInSeconds,
    retentionSeconds: config.retentionSeconds,
    deadLetter: QUEUE_REVIEW_PR_DLQ,
  });
}
