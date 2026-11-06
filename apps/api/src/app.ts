import express, { type Express } from "express";
import pino from "pino";
import type { PrismaClient } from "./generated/prisma/client.js";
import { genericWebhookPayloadSchema } from "./github/webhook-schemas.js";
import { verifyWebhookSignature } from "./github/verify-webhook-signature.js";
import {
  processWebhookPayload,
  type QueueProducer,
} from "./services/webhook-service.js";
import { getPrismaClient } from "./db/client.js";
import {
  OctokitGitHubUserClient,
  type GitHubUserClient,
} from "./github/user-client.js";
import { createAuthRoutes } from "./routes/auth-routes.js";
import { createDashboardRoutes } from "./routes/dashboard-routes.js";
import { csrfProtection } from "./auth/csrf.js";

export type AppOptions = {
  webhookSecret?: string;
  prisma?: PrismaClient;
  boss?: QueueProducer;
  userClient?: GitHubUserClient;
  clientId?: string;
  clientSecret?: string;
  callbackUrl?: string;
  frontendUrl?: string;
  trustedOrigins?: string[];
};

const logger = pino();

export function createApp(options: AppOptions = {}): Express {
  const app = express();
  app.set("trust proxy", 1);
  const getDb = () => options.prisma ?? getPrismaClient();
  const userClient = options.userClient ?? new OctokitGitHubUserClient();

  const frontendUrl =
    options.frontendUrl ?? process.env.FRONTEND_URL ?? "http://localhost:5173";
  const trustedOrigins = options.trustedOrigins ?? [frontendUrl];

  // CORS middleware for authenticated browser dashboard
  app.use((req, res, next) => {
    const origin = req.header("origin");
    if (origin && trustedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS, PATCH",
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, x-csrf-token, Authorization",
      );
    }
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    next();
  });

  app.get(["/healthz", "/api/healthz"], (_req, res) => {
    res.status(200).json({
      status: "ok",
      service: "reviewlens-api",
    });
  });

  app.get(["/readyz", "/api/readyz"], async (_req, res) => {
    try {
      const prisma = getDb();
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
    ["/webhooks/github", "/api/webhooks/github"],
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
          getDb(),
          deliveryId,
          event,
          parsedPayload.data,
          options.boss,
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

  // Parse JSON bodies for all API routes (scoped to /api to preserve webhook raw body)
  app.use("/api", express.json());

  // Enforce CSRF protection on API state-changing routes
  app.use("/api", csrfProtection(trustedOrigins));

  // Mount Authentication routes
  app.use(
    "/api/auth",
    createAuthRoutes({
      prisma: getDb,
      userClient,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      callbackUrl: options.callbackUrl,
      frontendUrl,
    }),
  );

  // Mount Dashboard and Review routes
  app.use(
    "/api",
    createDashboardRoutes({
      prisma: getDb,
      userClient,
    }),
  );

  return app;
}
