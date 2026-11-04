import {
  Prisma,
  DeliveryStatus,
  InstallationStatus,
  ReviewStatus,
  ReviewTrigger,
  type PrismaClient,
} from "@prisma/client";
import {
  githubPullRequestPayloadSchema,
  isSupportedPullRequestAction,
} from "../github/webhook-schemas.js";

export type WebhookProcessResult =
  | {
      status: 202;
      body: {
        received: true;
        deliveryId: string;
        runId: string;
        status: "queued";
      };
    }
  | {
      status: 200;
      body: {
        received: true;
        deliveryId: string;
        duplicate: true;
        message: string;
      };
    }
  | {
      status: 200;
      body: {
        received: true;
        deliveryId: string;
        ignored: true;
        reason: string;
      };
    }
  | {
      status: 400;
      body: {
        error: string;
      };
    };

export const MAX_DELIVERY_ATTEMPTS = 4;

export async function processWebhookPayload(
  prisma: PrismaClient,
  deliveryId: string,
  event: string,
  rawPayload: Record<string, unknown>,
): Promise<WebhookProcessResult> {
  const maxConcurrencyRetries = 5;
  let attempt = 0;

  while (attempt <= maxConcurrencyRetries) {
    try {
      return await executeWebhookProcessing(
        prisma,
        deliveryId,
        event,
        rawPayload,
      );
    } catch (err) {
      const isKnownPrisma = err instanceof Prisma.PrismaClientKnownRequestError;
      const isRetryable =
        isKnownPrisma && (err.code === "P2002" || err.code === "P2034");

      if (isRetryable && attempt < maxConcurrencyRetries) {
        attempt++;
        const delay = Math.floor(Math.random() * 30) + attempt * 25;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      if (isRetryable) {
        const recorded = await prisma.webhookDelivery.findUnique({
          where: { deliveryId },
        });
        if (recorded) {
          return {
            status: 200,
            body: {
              received: true,
              deliveryId,
              duplicate: true,
              message: "Delivery or run already processed",
            },
          };
        }
      }

      throw err;
    }
  }

  throw new Error("Unreachable concurrency state");
}

async function executeWebhookProcessing(
  prisma: PrismaClient,
  deliveryId: string,
  event: string,
  rawPayload: Record<string, unknown>,
): Promise<WebhookProcessResult> {
  // Pre-check: has this delivery ID already reached a terminal / completed state?
  const existingDelivery = await prisma.webhookDelivery.findUnique({
    where: { deliveryId },
  });

  if (existingDelivery) {
    // 0. ATTACHED: Work has already been linked to a run. Safe to acknowledge duplicate.
    if (existingDelivery.reviewRunId) {
      return {
        status: 200,
        body: {
          received: true,
          deliveryId,
          duplicate: true,
          message: "Delivery already processed",
        },
      };
    }

    // 1. ENQUEUED: Work has been accepted by the background queue. Safe to acknowledge duplicate.
    if (existingDelivery.status === DeliveryStatus.ENQUEUED) {
      return {
        status: 200,
        body: {
          received: true,
          deliveryId,
          duplicate: true,
          message: "Delivery already processed",
        },
      };
    }

    // 2. IGNORED: Intentionally excluded. Safe to acknowledge duplicate.
    if (existingDelivery.status === DeliveryStatus.IGNORED) {
      return {
        status: 200,
        body: {
          received: true,
          deliveryId,
          duplicate: true,
          message: "Delivery already processed",
        },
      };
    }

    // 3. FAILED: Follow documented retry policy; do not invent unlimited retries.
    if (
      existingDelivery.status === DeliveryStatus.FAILED &&
      existingDelivery.attemptCount >= MAX_DELIVERY_ATTEMPTS
    ) {
      return {
        status: 200,
        body: {
          received: true,
          deliveryId,
          duplicate: true,
          message: "Delivery failed and reached maximum retry attempts",
        },
      };
    }

    // 4. RECEIVED (or FAILED with attempts < MAX_DELIVERY_ATTEMPTS):
    // Incomplete or recoverable. Must re-enter safe processing and recovery path.
    // Check attempt limit to prevent unbounded processing loops on crashes.
    if (existingDelivery.attemptCount >= MAX_DELIVERY_ATTEMPTS) {
      if (existingDelivery.status !== DeliveryStatus.FAILED) {
        await prisma.webhookDelivery.update({
          where: { deliveryId },
          data: {
            status: DeliveryStatus.FAILED,
            error: "Delivery has exceeded maximum processing attempts",
          },
        });
      }
      return {
        status: 400,
        body: {
          error: "Delivery has exceeded maximum processing attempts",
        },
      };
    }
  }

  // Handle unsupported events
  if (event !== "pull_request") {
    const installationGithubId =
      rawPayload.installation &&
      typeof rawPayload.installation === "object" &&
      "id" in rawPayload.installation &&
      typeof rawPayload.installation.id === "number"
        ? BigInt(rawPayload.installation.id)
        : null;

    const action =
      typeof rawPayload.action === "string" ? rawPayload.action : null;

    await prisma.webhookDelivery.upsert({
      where: { deliveryId },
      create: {
        deliveryId,
        event,
        action,
        installationGithubId,
        status: DeliveryStatus.IGNORED,
        error: `Unsupported event type: ${event}`,
        attemptCount: 1,
        lastAttemptAt: new Date(),
      },
      update: {
        status: DeliveryStatus.IGNORED,
        error: `Unsupported event type: ${event}`,
        attemptCount: existingDelivery ? existingDelivery.attemptCount + 1 : 1,
        lastAttemptAt: new Date(),
      },
    });

    return {
      status: 200,
      body: {
        received: true,
        deliveryId,
        ignored: true,
        reason: `Unsupported event type: ${event}`,
      },
    };
  }

  // Validate pull_request payload schema
  const parsed = githubPullRequestPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return {
      status: 400,
      body: {
        error: "Malformed or incomplete pull_request payload structure",
      },
    };
  }

  const payload = parsed.data;

  // Filter unsupported actions
  if (!isSupportedPullRequestAction(payload.action)) {
    await prisma.webhookDelivery.upsert({
      where: { deliveryId },
      create: {
        deliveryId,
        event,
        action: payload.action,
        installationGithubId: payload.installation
          ? BigInt(payload.installation.id)
          : null,
        status: DeliveryStatus.IGNORED,
        error: `Unsupported action: ${payload.action}`,
        attemptCount: 1,
        lastAttemptAt: new Date(),
      },
      update: {
        status: DeliveryStatus.IGNORED,
        error: `Unsupported action: ${payload.action}`,
        attemptCount: existingDelivery ? existingDelivery.attemptCount + 1 : 1,
        lastAttemptAt: new Date(),
      },
    });

    return {
      status: 200,
      body: {
        received: true,
        deliveryId,
        ignored: true,
        reason: `Unsupported action: ${payload.action}`,
      },
    };
  }

  // Filter draft PRs
  if (payload.pull_request.draft === true) {
    await prisma.webhookDelivery.upsert({
      where: { deliveryId },
      create: {
        deliveryId,
        event,
        action: payload.action,
        installationGithubId: payload.installation
          ? BigInt(payload.installation.id)
          : null,
        status: DeliveryStatus.IGNORED,
        error: "Draft pull request",
        attemptCount: 1,
        lastAttemptAt: new Date(),
      },
      update: {
        status: DeliveryStatus.IGNORED,
        error: "Draft pull request",
        attemptCount: existingDelivery ? existingDelivery.attemptCount + 1 : 1,
        lastAttemptAt: new Date(),
      },
    });

    return {
      status: 200,
      body: {
        received: true,
        deliveryId,
        ignored: true,
        reason: "Draft pull request",
      },
    };
  }

  // Filter bot authors
  const authorLogin = payload.pull_request.user?.login ?? "";
  const authorType = payload.pull_request.user?.type ?? "";
  if (authorType === "Bot" || authorLogin.endsWith("[bot]")) {
    await prisma.webhookDelivery.upsert({
      where: { deliveryId },
      create: {
        deliveryId,
        event,
        action: payload.action,
        installationGithubId: payload.installation
          ? BigInt(payload.installation.id)
          : null,
        status: DeliveryStatus.IGNORED,
        error: `Bot author ignored: ${authorLogin}`,
        attemptCount: 1,
        lastAttemptAt: new Date(),
      },
      update: {
        status: DeliveryStatus.IGNORED,
        error: `Bot author ignored: ${authorLogin}`,
        attemptCount: existingDelivery ? existingDelivery.attemptCount + 1 : 1,
        lastAttemptAt: new Date(),
      },
    });

    return {
      status: 200,
      body: {
        received: true,
        deliveryId,
        ignored: true,
        reason: `Bot author ignored: ${authorLogin}`,
      },
    };
  }

  return await prisma.$transaction(async (tx) => {
    const installationGithubId = payload.installation
      ? BigInt(payload.installation.id)
      : BigInt(payload.repository.id);

    const accountLogin =
      payload.installation?.account?.login ??
      payload.repository.owner?.login ??
      "unknown";
    const accountType = payload.installation?.account?.type ?? "Organization";

    const installation = await tx.installation.upsert({
      where: { githubInstallationId: installationGithubId },
      create: {
        githubInstallationId: installationGithubId,
        accountLogin,
        accountType,
        status: InstallationStatus.ACTIVE,
      },
      update: {},
    });

    const githubRepoId = BigInt(payload.repository.id);
    const repository = await tx.repository.upsert({
      where: { githubRepoId },
      create: {
        installationId: installation.id,
        githubRepoId,
        fullName: payload.repository.full_name,
        defaultBranch: payload.repository.default_branch ?? null,
        enabled: true,
      },
      update: {
        fullName: payload.repository.full_name,
      },
    });

    if (!repository.enabled) {
      await tx.webhookDelivery.upsert({
        where: { deliveryId },
        create: {
          deliveryId,
          event,
          action: payload.action,
          installationGithubId,
          status: DeliveryStatus.IGNORED,
          error: "Repository is disabled",
          attemptCount: 1,
          lastAttemptAt: new Date(),
        },
        update: {
          status: DeliveryStatus.IGNORED,
          error: "Repository is disabled",
          attemptCount: existingDelivery
            ? existingDelivery.attemptCount + 1
            : 1,
          lastAttemptAt: new Date(),
        },
      });

      return {
        status: 200,
        body: {
          received: true,
          deliveryId,
          ignored: true,
          reason: "Repository is disabled",
        },
      };
    }

    // Record delivery state
    await tx.webhookDelivery.upsert({
      where: { deliveryId },
      create: {
        deliveryId,
        event,
        action: payload.action,
        installationGithubId,
        status: DeliveryStatus.RECEIVED,
        attemptCount: 1,
        lastAttemptAt: new Date(),
      },
      update: {
        status: DeliveryStatus.RECEIVED,
        error: null,
        attemptCount: existingDelivery ? existingDelivery.attemptCount + 1 : 1,
        lastAttemptAt: new Date(),
      },
    });

    const baseSha = payload.pull_request.base.sha;

    // Check if a review run already exists for this repository, PR number, head SHA, and base SHA
    const existingRun = await tx.reviewRun.findUnique({
      where: {
        repositoryId_prNumber_headSha_baseSha: {
          repositoryId: repository.id,
          prNumber: payload.number,
          headSha: payload.pull_request.head.sha,
          baseSha,
        },
      },
    });

    if (existingRun) {
      await tx.webhookDelivery.update({
        where: { deliveryId },
        data: { reviewRunId: existingRun.id },
      });

      return {
        status: 200,
        body: {
          received: true,
          deliveryId,
          duplicate: true,
          message: "Review run already exists for this commit",
        },
      };
    }

    // Create new review run
    const run = await tx.reviewRun.create({
      data: {
        repositoryId: repository.id,
        prNumber: payload.number,
        headSha: payload.pull_request.head.sha,
        baseSha,
        status: ReviewStatus.QUEUED,
        trigger: ReviewTrigger.WEBHOOK,
      },
    });

    await tx.webhookDelivery.update({
      where: { deliveryId },
      data: { reviewRunId: run.id },
    });

    return {
      status: 202,
      body: {
        received: true,
        deliveryId,
        runId: run.id,
        status: "queued",
      },
    };
  });
}
