import {
  Prisma,
  type PrismaClient,
  type Installation,
  type Repository,
  type WebhookDelivery,
  type ReviewRun,
  InstallationStatus,
  ReviewStatus,
  ReviewTrigger,
} from "@prisma/client";

export interface MockStorage {
  installations: Map<string, Installation>;
  repositories: Map<string, Repository>;
  webhookDeliveries: Map<string, WebhookDelivery>;
  reviewRuns: Map<string, ReviewRun>;
  shouldFail: boolean;
}

export type MockPrismaClient = PrismaClient & {
  _storage: MockStorage;
};

export function createMockPrismaClient(): MockPrismaClient {
  const storage: MockStorage = {
    installations: new Map(),
    repositories: new Map(),
    webhookDeliveries: new Map(),
    reviewRuns: new Map(),
    shouldFail: false,
  };

  const client = {
    _storage: storage,

    $queryRaw: async (): Promise<unknown> => {
      if (storage.shouldFail) {
        throw new Prisma.PrismaClientInitializationError(
          "Can't reach database server at `localhost:5432`",
          "6.19.3",
        );
      }
      return [{ 1: 1 }];
    },

    $transaction: async <T>(
      callback: (tx: Prisma.TransactionClient) => Promise<T>,
    ): Promise<T> => {
      if (storage.shouldFail) {
        throw new Prisma.PrismaClientInitializationError(
          "Can't reach database server at `localhost:5432`",
          "6.19.3",
        );
      }
      return callback(client as unknown as Prisma.TransactionClient);
    },

    webhookDelivery: {
      findUnique: async ({
        where,
      }: {
        where: { deliveryId: string };
      }): Promise<WebhookDelivery | null> => {
        if (storage.shouldFail) {
          throw new Prisma.PrismaClientInitializationError(
            "Can't reach database server at `localhost:5432`",
            "6.19.3",
          );
        }
        return storage.webhookDeliveries.get(where.deliveryId) ?? null;
      },
      update: async ({
        where,
        data,
      }: {
        where: { deliveryId: string };
        data:
          | Prisma.WebhookDeliveryUpdateInput
          | Prisma.WebhookDeliveryUncheckedUpdateInput;
      }): Promise<WebhookDelivery> => {
        if (storage.shouldFail) {
          throw new Prisma.PrismaClientInitializationError(
            "Can't reach database server at `localhost:5432`",
            "6.19.3",
          );
        }
        const existing = storage.webhookDeliveries.get(where.deliveryId);
        if (!existing) {
          throw new Error(`Record to update not found: ${where.deliveryId}`);
        }
        const reviewRunId =
          ("reviewRun" in data ? data.reviewRun?.connect?.id : undefined) ??
          ("reviewRunId" in data
            ? (data.reviewRunId as string | null | undefined)
            : undefined) ??
          existing.reviewRunId;
        const updated: WebhookDelivery = {
          ...existing,
          ...(data as Partial<WebhookDelivery>),
          reviewRunId,
          updatedAt: new Date(),
        };
        storage.webhookDeliveries.set(where.deliveryId, updated);
        return updated;
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { deliveryId: string };
        create:
          | Prisma.WebhookDeliveryCreateInput
          | Prisma.WebhookDeliveryUncheckedCreateInput;
        update:
          | Prisma.WebhookDeliveryUpdateInput
          | Prisma.WebhookDeliveryUncheckedUpdateInput;
      }): Promise<WebhookDelivery> => {
        if (storage.shouldFail) {
          throw new Prisma.PrismaClientInitializationError(
            "Can't reach database server at `localhost:5432`",
            "6.19.3",
          );
        }
        const existing = storage.webhookDeliveries.get(where.deliveryId);
        if (existing) {
          const reviewRunId =
            ("reviewRun" in update
              ? update.reviewRun?.connect?.id
              : undefined) ??
            ("reviewRunId" in update
              ? (update.reviewRunId as string | null | undefined)
              : undefined) ??
            existing.reviewRunId;
          const updated: WebhookDelivery = {
            ...existing,
            ...(update as Partial<WebhookDelivery>),
            reviewRunId,
            updatedAt: new Date(),
          };
          storage.webhookDeliveries.set(where.deliveryId, updated);
          return updated;
        }

        const reviewRunId =
          ("reviewRun" in create ? create.reviewRun?.connect?.id : undefined) ??
          ("reviewRunId" in create
            ? (create.reviewRunId as string | null | undefined)
            : undefined) ??
          null;

        const record: WebhookDelivery = {
          deliveryId: where.deliveryId,
          event: create.event,
          action: (create.action as string | null) ?? null,
          installationGithubId:
            (create.installationGithubId as bigint | null) ?? null,
          status: create.status,
          error: (create.error as string | null) ?? null,
          attemptCount: (create.attemptCount as number) ?? 0,
          lastAttemptAt: (create.lastAttemptAt as Date | null) ?? null,
          receivedAt: new Date(),
          updatedAt: new Date(),
          reviewRunId,
        };
        storage.webhookDeliveries.set(where.deliveryId, record);
        return record;
      },
    },

    installation: {
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { githubInstallationId: bigint };
        create: Prisma.InstallationCreateInput;
        update: Prisma.InstallationUpdateInput;
      }): Promise<Installation> => {
        if (storage.shouldFail) {
          throw new Prisma.PrismaClientInitializationError(
            "Can't reach database server at `localhost:5432`",
            "6.19.3",
          );
        }
        const key = where.githubInstallationId.toString();
        const existing = storage.installations.get(key);
        if (existing) {
          const updated: Installation = {
            ...existing,
            ...(update as Partial<Installation>),
            updatedAt: new Date(),
          };
          storage.installations.set(key, updated);
          return updated;
        }

        const record: Installation = {
          id: `inst-${key}`,
          githubInstallationId: where.githubInstallationId,
          accountLogin: create.accountLogin,
          accountType: create.accountType,
          status:
            (create.status as InstallationStatus) ?? InstallationStatus.ACTIVE,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        storage.installations.set(key, record);
        return record;
      },
    },

    repository: {
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { githubRepoId: bigint };
        create: Prisma.RepositoryCreateInput;
        update: Prisma.RepositoryUpdateInput;
      }): Promise<Repository> => {
        if (storage.shouldFail) {
          throw new Prisma.PrismaClientInitializationError(
            "Can't reach database server at `localhost:5432`",
            "6.19.3",
          );
        }
        const key = where.githubRepoId.toString();
        const existing = storage.repositories.get(key);
        if (existing) {
          const updated: Repository = {
            ...existing,
            ...(update as Partial<Repository>),
            updatedAt: new Date(),
          };
          storage.repositories.set(key, updated);
          return updated;
        }

        const installationId =
          create.installation?.connect?.id ??
          (create.installation as unknown as { id: string })?.id ??
          "inst-default";

        const record: Repository = {
          id: `repo-${key}`,
          installationId,
          githubRepoId: where.githubRepoId,
          fullName: create.fullName,
          defaultBranch: (create.defaultBranch as string | null) ?? null,
          enabled: create.enabled ?? true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        storage.repositories.set(key, record);
        return record;
      },
    },

    reviewRun: {
      findUnique: async ({
        where,
      }: {
        where: {
          repositoryId_prNumber_headSha_baseSha: {
            repositoryId: string;
            prNumber: number;
            headSha: string;
            baseSha: string;
          };
        };
      }): Promise<ReviewRun | null> => {
        if (storage.shouldFail) {
          throw new Prisma.PrismaClientInitializationError(
            "Can't reach database server at `localhost:5432`",
            "6.19.3",
          );
        }
        const { repositoryId, prNumber, headSha, baseSha } =
          where.repositoryId_prNumber_headSha_baseSha;
        const key = `${repositoryId}:${prNumber}:${headSha}:${baseSha}`;
        return storage.reviewRuns.get(key) ?? null;
      },
      create: async ({
        data,
      }: {
        data: Prisma.ReviewRunCreateInput;
      }): Promise<ReviewRun> => {
        if (storage.shouldFail) {
          throw new Prisma.PrismaClientInitializationError(
            "Can't reach database server at `localhost:5432`",
            "6.19.3",
          );
        }
        const repositoryId =
          (data as { repositoryId?: string }).repositoryId ??
          data.repository?.connect?.id ??
          (data.repository as unknown as { id: string })?.id ??
          "repo-default";

        const baseSha = data.baseSha;
        const key = `${repositoryId}:${data.prNumber}:${data.headSha}:${baseSha}`;
        if (storage.reviewRuns.has(key)) {
          throw new Prisma.PrismaClientKnownRequestError(
            "Unique constraint failed on the constraint: `review_runs_repository_id_pr_number_head_sha_base_sha_key`",
            {
              code: "P2002",
              clientVersion: "6.19.3",
              meta: {
                target: ["repository_id", "pr_number", "head_sha", "base_sha"],
              },
            },
          );
        }

        const record: ReviewRun = {
          id: `run-${Math.random().toString(36).substring(2, 10)}`,
          repositoryId,
          prNumber: data.prNumber,
          headSha: data.headSha,
          baseSha,
          status: (data.status as ReviewStatus) ?? ReviewStatus.QUEUED,
          degradedReason: null,
          failureReason: null,
          trigger: (data.trigger as ReviewTrigger) ?? ReviewTrigger.WEBHOOK,
          configHash: null,
          filesTotal: null,
          filesReviewed: null,
          candidateCount: null,
          postedCount: null,
          tokensIn: null,
          tokensOut: null,
          estCostUsd: null,
          githubReviewId: null,
          createdAt: new Date(),
          startedAt: null,
          finishedAt: null,
        };
        storage.reviewRuns.set(key, record);
        return record;
      },
    },
  };

  return client as unknown as MockPrismaClient;
}
