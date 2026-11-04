import express, { type Express } from "express";
import pino from "pino";
import type { PrismaClient } from "@prisma/client";
import { genericWebhookPayloadSchema } from "./github/webhook-schemas.js";
import { verifyWebhookSignature } from "./github/verify-webhook-signature.js";
import { processWebhookPayload } from "./services/webhook-service.js";
import { getPrismaClient } from "./db/client.js";

export type AppOptions = {
  webhookSecret?: string;
  prisma?: PrismaClient;
};

const logger = pino();

export function createApp(options: AppOptions = {}): Express {
  const app = express();
  const prisma = options.prisma ?? getPrismaClient();

  app.get("/healthz", (_req, res) => {
    res.status(200).json({
      status: "ok",
      service: "reviewlens-api",
    });
  });

  app.get("/readyz", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return res.status(200).json({
        status: "ready",
        service: "reviewlens-api",
        database: "connected",
      });
    } catch {
      return res.status(503).json({
        status: "not_ready",
        service: "reviewlens-api",
        database: "disconnected",
      });
    }
  });

  app.post(
    "/webhooks/github",
    express.raw({
      type: "application/json",
      limit: "1mb",
    }),
    async (req, res) => {
      if (!options.webhookSecret) {
        return res.status(503).json({
          error: "Webhook secret is not configured",
        });
      }

      if (!Buffer.isBuffer(req.body)) {
        return res.status(400).json({
          error: "Expected a raw JSON request body",
        });
      }

      const signature = req.header("x-hub-signature-256");

      const validSignature = verifyWebhookSignature(
        req.body,
        signature,
        options.webhookSecret,
      );

      if (!validSignature) {
        return res.status(401).json({
          error: "Invalid webhook signature",
        });
      }

      const event = req.header("x-github-event");
      const deliveryId = req.header("x-github-delivery");

      if (!event || !deliveryId) {
        return res.status(400).json({
          error: "Missing GitHub event headers",
        });
      }

      let payload: unknown;

      try {
        payload = JSON.parse(req.body.toString("utf8"));
      } catch {
        return res.status(400).json({
          error: "Malformed JSON payload",
        });
      }

      const parsedPayload = genericWebhookPayloadSchema.safeParse(payload);

      if (!parsedPayload.success) {
        return res.status(400).json({
          error: "Expected a JSON object payload",
        });
      }

      logger.info({ event, deliveryId }, "Verified GitHub webhook signature");

      try {
        const result = await processWebhookPayload(
          prisma,
          deliveryId,
          event,
          parsedPayload.data,
        );

        return res.status(result.status).json(result.body);
      } catch (err) {
        logger.error(
          {
            event,
            deliveryId,
            err: err instanceof Error ? err.message : "Database error",
          },
          "Database operation failed during webhook processing",
        );

        return res.status(503).json({
          error: "Database service unavailable",
        });
      }
    },
  );

  return app;
}
