import pino from "pino";
import "dotenv/config";
import { loadFileSecrets } from "./config/secrets.js";

loadFileSecrets();

import { getPrismaClient, disconnectPrismaClient } from "./db/client.js";
import { createPgBoss, startPgBoss, stopPgBoss } from "./queue/client.js";
import { ensureQueues } from "./queue/setup-queues.js";
import { registerReviewWorker } from "./workers/review-worker.js";
import { registerDeadLetterWorker } from "./workers/dead-letter-worker.js";

const logger = pino();
const prisma = getPrismaClient();

const boss = createPgBoss({
  application_name: "reviewlens-worker-boss",
});

await startPgBoss(boss);
await ensureQueues(boss);

logger.info("Starting ReviewLens worker process...");

await registerReviewWorker(boss, prisma);
await registerDeadLetterWorker(boss, prisma);

logger.info("ReviewLens worker handlers registered and listening for jobs");

let isShuttingDown = false;
async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ signal }, "ReviewLens worker shutting down gracefully");

  try {
    await stopPgBoss(boss);
    await disconnectPrismaClient();
    logger.info("ReviewLens worker shutdown complete");
    process.exit(0);
  } catch (err) {
    logger.error({ err }, "Error during ReviewLens worker shutdown");
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
