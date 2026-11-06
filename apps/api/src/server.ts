import pino from "pino";
import "dotenv/config";
import { loadFileSecrets } from "./config/secrets.js";

loadFileSecrets();

import { createApp } from "./app.js";
import { getPrismaClient, disconnectPrismaClient } from "./db/client.js";
import { createPgBoss, startPgBoss, stopPgBoss } from "./queue/client.js";
import { ensureQueues } from "./queue/setup-queues.js";

const logger = pino();
const prisma = getPrismaClient();

const boss = createPgBoss({
  application_name: "reviewlens-api-boss",
});

await startPgBoss(boss);
await ensureQueues(boss);

const app = createApp({
  webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
  prisma,
  boss,
});

const port = Number(process.env.PORT ?? 3001);
const server = app.listen(port, () => {
  logger.info({ port }, "ReviewLens API listening");
});

let isShuttingDown = false;
async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ signal }, "ReviewLens API shutting down gracefully");

  server.close(async () => {
    try {
      await stopPgBoss(boss);
      await disconnectPrismaClient();
      logger.info("ReviewLens API shutdown complete");
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "Error during ReviewLens API shutdown");
      process.exit(1);
    }
  });

  // Force close after 10 seconds if graceful close hangs
  setTimeout(() => {
    logger.error("Forced ReviewLens API shutdown after timeout");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
