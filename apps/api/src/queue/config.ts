export interface QueueConfig {
  schema: string;
  connectionString?: string;
  poolMax: number;
  connectionTimeoutMillis: number;
  retryLimit: number;
  retryDelay: number;
  retryBackoff: boolean;
  retryDelayMax: number;
  expireInSeconds: number;
  retentionSeconds: number;
  workerConcurrency: number;
}

export function getQueueConfig(): QueueConfig {
  return {
    schema: process.env.PGBOSS_SCHEMA || "pgboss",
    connectionString: process.env.DATABASE_URL,
    poolMax: Number(process.env.PGBOSS_POOL_MAX || 5),
    connectionTimeoutMillis: Number(
      process.env.PGBOSS_CONNECTION_TIMEOUT_MS || 5000,
    ),
    retryLimit: Number(process.env.REVIEW_QUEUE_RETRY_LIMIT || 3),
    retryDelay: Number(process.env.REVIEW_QUEUE_RETRY_DELAY_SECONDS || 15),
    retryBackoff: true,
    retryDelayMax: Number(
      process.env.REVIEW_QUEUE_RETRY_DELAY_MAX_SECONDS || 900,
    ),
    expireInSeconds: Number(process.env.REVIEW_QUEUE_EXPIRE_SECONDS || 300),
    retentionSeconds: Number(
      process.env.REVIEW_QUEUE_RETENTION_SECONDS || 86400,
    ),
    workerConcurrency: Number(process.env.WORKER_CONCURRENCY || 1),
  };
}
