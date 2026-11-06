import { PgBoss, fromPrisma } from "pg-boss";
import { getQueueConfig } from "./config.js";

export interface CreatePgBossOptions {
  connectionString?: string;
  schema?: string;
  max?: number;
  application_name?: string;
  connectionTimeoutMillis?: number;
}

export function createPgBoss(options: CreatePgBossOptions = {}): PgBoss {
  const config = getQueueConfig();
  const connectionString = options.connectionString ?? config.connectionString;

  if (!connectionString) {
    throw new Error(
      "Database connection string is required to initialize PgBoss",
    );
  }

  return new PgBoss({
    connectionString,
    schema: options.schema ?? config.schema,
    max: options.max ?? config.poolMax,
    application_name: options.application_name ?? "reviewlens-boss",
  });
}

export async function startPgBoss(boss: PgBoss): Promise<PgBoss> {
  await boss.start();
  return boss;
}

export async function stopPgBoss(boss: PgBoss): Promise<void> {
  await boss.stop({ graceful: true, timeout: 5000 });
}

export { fromPrisma, PgBoss };
