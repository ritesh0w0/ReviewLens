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

export async function processWebhookPayload(
  prisma: PrismaClient,
  deliveryId: string,
  event: string,
  rawPayload: Record<string, unknown>,
): Promise<WebhookProcessResult> {
  // Pre-check: has this delivery ID already been successfully recorded?
  const existingDelivery = await prisma.webhookDelivery.findUnique({
    where: { deliveryId },
  });

  if (existingDelivery && existingDelivery.status !== DeliveryStatus.FAILED) {
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
      },
      update: {
        status: DeliveryStatus.IGNORED,
        error: `Unsupported event type: ${event}`,
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
      },
      update: {
        status: DeliveryStatus.IGNORED,
        error: `Unsupported action: ${payload.action}`,
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
      },
      update: {
        status: DeliveryStatus.IGNORED,
        error: "Draft pull request",
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
      },
      update: {
        status: DeliveryStatus.IGNORED,
        error: `Bot author ignored: ${authorLogin}`,
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

  try {
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
          },
          update: {
            status: DeliveryStatus.IGNORED,
            error: "Repository is disabled",
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
        },
        update: {
          status: DeliveryStatus.RECEIVED,
          error: null,
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
      try {
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
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
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
        throw err;
      }
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
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
    throw err;
  }
}
