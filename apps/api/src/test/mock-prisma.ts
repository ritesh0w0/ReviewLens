/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
// In-memory Prisma test double uses dynamic typing for polymorphic queries, inclusions, and relations.
import {
  Prisma,
  type PrismaClient,
  type Installation,
  type Repository,
  type WebhookDelivery,
  type ReviewRun,
  type AIReviewExecution,
  type AIReviewChunk,
  type AIInferenceAttempt,
  type User,
  type Session,
  type OAuthTransaction,
  type UserInstallationGrant,
  type UserRepositoryGrant,
  type ReviewFinding,
  InstallationStatus,
  ReviewStatus,
  ReviewTrigger,
  AIExecutionStatus,
} from "../generated/prisma/client.js";

export interface MockStorage {
  installations: Map<string, Installation>;
  repositories: Map<string, Repository>;
  webhookDeliveries: Map<string, WebhookDelivery>;
  reviewRuns: Map<string, ReviewRun>;
  aiExecutions: Map<string, AIReviewExecution>;
  aiChunks: Map<string, AIReviewChunk>;
  aiAttempts: Map<string, AIInferenceAttempt>;
  users: Map<string, User>;
  sessions: Map<string, Session>;
  oauthTransactions: Map<string, OAuthTransaction>;
  userInstallationGrants: Map<string, UserInstallationGrant>;
  userRepositoryGrants: Map<string, UserRepositoryGrant>;
  reviewFindings: Map<string, ReviewFinding>;
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
    aiExecutions: new Map(),
    aiChunks: new Map(),
    aiAttempts: new Map(),
    users: new Map(),
    sessions: new Map(),
    oauthTransactions: new Map(),
    userInstallationGrants: new Map(),
    userRepositoryGrants: new Map(),
    reviewFindings: new Map(),
    shouldFail: false,
  };

  const client = {
    _storage: storage,

    $queryRaw: async (): Promise<unknown> => {
      if (storage.shouldFail) {
        throw new Prisma.PrismaClientInitializationError(
          "Can't reach database server at `localhost:5432`",
          "7.10.1",
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
          "7.10.1",
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
            "7.10.1",
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
            "7.10.1",
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
            "7.10.1",
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
      create: async ({
        data,
      }: {
        data: Prisma.InstallationCreateInput;
      }): Promise<Installation> => {
        const githubInstallationId = BigInt(data.githubInstallationId);
        const id =
          (data as { id?: string }).id ??
          `inst-${githubInstallationId.toString()}`;
        const record: Installation = {
          id,
          githubInstallationId,
          accountLogin: data.accountLogin,
          accountType: data.accountType,
          status:
            (data.status as InstallationStatus) ?? InstallationStatus.ACTIVE,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        storage.installations.set(githubInstallationId.toString(), record);
        return record;
      },

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
            "7.10.1",
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
      create: async ({
        data,
      }: {
        data: Prisma.RepositoryCreateInput;
      }): Promise<Repository> => {
        const githubRepoId = BigInt(data.githubRepoId);
        const id =
          (data as { id?: string }).id ?? `repo-${githubRepoId.toString()}`;
        const installationId =
          (data as { installationId?: string }).installationId ??
          data.installation?.connect?.id ??
          "inst-default";
        const record: Repository = {
          id,
          installationId,
          githubRepoId,
          fullName: data.fullName,
          defaultBranch: data.defaultBranch ?? "main",
          enabled: data.enabled ?? true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        storage.repositories.set(githubRepoId.toString(), record);
        return record;
      },

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
            "7.10.1",
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

      findUnique: async ({
        where,
      }: {
        where: { id?: string; githubRepoId?: bigint | number };
      }): Promise<Repository | null> => {
        if (where.id) {
          for (const repo of storage.repositories.values()) {
            if (repo.id === where.id) return repo;
          }
        }
        if (where.githubRepoId != null) {
          const key = where.githubRepoId.toString();
          return storage.repositories.get(key) ?? null;
        }
        return null;
      },

      findMany: async ({
        where,
        include,
      }: {
        where?: {
          githubRepoId?: { in?: bigint[] };
          id?: { in?: string[] };
        };
        include?: {
          _count?: { select?: { reviewRuns?: boolean } };
          reviewRuns?: {
            orderBy?: { createdAt?: "asc" | "desc" };
            take?: number;
            select?: {
              status?: boolean;
              createdAt?: boolean;
              finishedAt?: boolean;
            };
          };
        };
      } = {}): Promise<any[]> => {
        const list: any[] = [];
        for (const repo of storage.repositories.values()) {
          if (where?.githubRepoId?.in) {
            const inList = where.githubRepoId.in.map((id) => id.toString());
            if (!inList.includes(repo.githubRepoId.toString())) continue;
          }
          if (where?.id?.in) {
            if (!where.id.in.includes(repo.id)) continue;
          }

          const item: any = { ...repo };
          if (include?._count?.select?.reviewRuns) {
            let runCount = 0;
            const seen = new Set<string>();
            for (const run of storage.reviewRuns.values()) {
              if (seen.has(run.id)) continue;
              seen.add(run.id);
              if (run.repositoryId === repo.id) runCount++;
            }
            item._count = { reviewRuns: runCount };
          }
          if (include?.reviewRuns) {
            const repoRuns: any[] = [];
            const seen = new Set<string>();
            for (const run of storage.reviewRuns.values()) {
              if (seen.has(run.id)) continue;
              seen.add(run.id);
              if (run.repositoryId === repo.id) repoRuns.push(run);
            }
            repoRuns.sort(
              (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
            );
            item.reviewRuns = repoRuns.slice(0, include.reviewRuns.take ?? 1);
          }
          list.push(item);
        }
        return list;
      },
    },

    reviewRun: {
      findUnique: async ({
        where,
        include,
      }: {
        where: {
          id?: string;
          repositoryId_prNumber_headSha_baseSha?: {
            repositoryId: string;
            prNumber: number;
            headSha: string;
            baseSha: string;
          };
        };
        include?: {
          repository?: {
            include?: {
              installation?: boolean;
            };
          };
          aiExecution?:
            | boolean
            | {
                include?: {
                  chunks?: boolean | { include?: { attempts?: boolean } };
                };
              };
          findings?: boolean;
        };
      }): Promise<
        | (ReviewRun & {
            repository: Repository & { installation: Installation };
          })
        | ReviewRun
        | null
      > => {
        if (storage.shouldFail) {
          throw new Prisma.PrismaClientInitializationError(
            "Can't reach database server at `localhost:5432`",
            "7.10.1",
          );
        }
        let record: ReviewRun | null = null;
        if (where.id) {
          for (const run of storage.reviewRuns.values()) {
            if (run.id === where.id) {
              record = run;
              break;
            }
          }
        } else if (where.repositoryId_prNumber_headSha_baseSha) {
          const { repositoryId, prNumber, headSha, baseSha } =
            where.repositoryId_prNumber_headSha_baseSha;
          const key = `${repositoryId}:${prNumber}:${headSha}:${baseSha}`;
          record = storage.reviewRuns.get(key) ?? null;
        }

        if (!record) return null;

        if (include?.repository) {
          let foundRepo: Repository | undefined;
          for (const repo of storage.repositories.values()) {
            if (repo.id === record.repositoryId) {
              foundRepo = repo;
              break;
            }
          }
          if (!foundRepo) {
            foundRepo = {
              id: record.repositoryId,
              installationId: "inst-default",
              fullName: "test-org/test-repo",
              defaultBranch: "main",
              enabled: true,
              githubRepoId: 1n,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
          }

          let foundInst: Installation = {
            id: foundRepo.installationId,
            githubInstallationId: 1n,
            accountLogin: "test-org",
            accountType: "Organization",
            status: InstallationStatus.ACTIVE,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          for (const inst of storage.installations.values()) {
            if (inst.id === foundRepo.installationId) {
              foundInst = inst;
              break;
            }
          }

          const result: any = {
            ...record,
            repository: {
              ...foundRepo,
              installation: foundInst,
            },
          };

          if (include?.aiExecution) {
            let foundExec: any = null;
            for (const exec of storage.aiExecutions.values()) {
              if (exec.reviewRunId === record.id) {
                foundExec = { ...exec };
                break;
              }
            }
            if (foundExec) {
              const chunks: any[] = [];
              for (const ch of storage.aiChunks.values()) {
                if (ch.executionId === foundExec.id) {
                  const chunkItem: any = { ...ch, attempts: [] };
                  for (const att of storage.aiAttempts.values()) {
                    if (att.chunkId === ch.id) {
                      chunkItem.attempts.push(att);
                    }
                  }
                  chunks.push(chunkItem);
                }
              }
              chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
              foundExec.chunks = chunks;
            }
            result.aiExecution = foundExec;
          }

          return result;
        }

        const result: any = { ...record };
        if (include?.aiExecution) {
          let foundExec: any = null;
          for (const exec of storage.aiExecutions.values()) {
            if (exec.reviewRunId === record.id) {
              foundExec = { ...exec };
              break;
            }
          }
          if (foundExec) {
            const chunks: any[] = [];
            for (const ch of storage.aiChunks.values()) {
              if (ch.executionId === foundExec.id) {
                const chunkItem: any = { ...ch, attempts: [] };
                for (const att of storage.aiAttempts.values()) {
                  if (att.chunkId === ch.id) {
                    chunkItem.attempts.push(att);
                  }
                }
                chunks.push(chunkItem);
              }
            }
            chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
            foundExec.chunks = chunks;
          }
          result.aiExecution = foundExec;
        }

        return result;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Prisma.ReviewRunUpdateInput;
      }): Promise<ReviewRun> => {
        if (storage.shouldFail) {
          throw new Prisma.PrismaClientInitializationError(
            "Can't reach database server at `localhost:5432`",
            "7.10.1",
          );
        }
        for (const run of storage.reviewRuns.values()) {
          if (run.id === where.id) {
            Object.assign(run, data);
            return run;
          }
        }
        throw new Prisma.PrismaClientKnownRequestError(
          "An operation failed because it depends on one or more records that were required but not found.",
          { code: "P2025", clientVersion: "7.10.1" },
        );
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: {
          id?: string;
          claimToken?: string;
          OR?: Array<{
            status?: ReviewStatus;
            attemptCount?: { lt?: number };
          }>;
        };
        data: Prisma.ReviewRunUpdateManyMutationInput;
      }): Promise<{ count: number }> => {
        if (storage.shouldFail) {
          throw new Prisma.PrismaClientInitializationError(
            "Can't reach database server at `localhost:5432`",
            "7.10.1",
          );
        }
        let count = 0;
        for (const run of storage.reviewRuns.values()) {
          if (where.id && run.id !== where.id) {
            continue;
          }
          if (where.claimToken && run.claimToken !== where.claimToken) {
            continue;
          }
          if (where.OR && Array.isArray(where.OR)) {
            const matchesOr = where.OR.some((cond) => {
              if (cond.status && run.status !== cond.status) {
                return false;
              }
              if (cond.attemptCount?.lt !== undefined) {
                if (run.attemptCount >= cond.attemptCount.lt) {
                  return false;
                }
              }
              return true;
            });
            if (!matchesOr) {
              continue;
            }
          }
          Object.assign(run, data);
          count++;
        }
        return { count };
      },
      create: async ({
        data,
      }: {
        data: Prisma.ReviewRunCreateInput;
      }): Promise<ReviewRun> => {
        if (storage.shouldFail) {
          throw new Prisma.PrismaClientInitializationError(
            "Can't reach database server at `localhost:5432`",
            "7.10.1",
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
              clientVersion: "7.10.1",
              meta: {
                target: ["repository_id", "pr_number", "head_sha", "base_sha"],
              },
            },
          );
        }

        const id =
          (data as { id?: string }).id ??
          `run-${Math.random().toString(36).substring(2, 10)}`;

        const record: ReviewRun = {
          id,
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
          claimToken: (data as { claimToken?: string }).claimToken ?? null,
          attemptCount: (data as { attemptCount?: number }).attemptCount ?? 0,
          lastAttemptAt: null,
          createdAt: new Date(),
          startedAt: null,
          finishedAt: null,
        };
        storage.reviewRuns.set(key, record);
        return record;
      },

      count: async ({ where }: { where?: any } = {}): Promise<number> => {
        let count = 0;
        const seenIds = new Set<string>();
        for (const run of storage.reviewRuns.values()) {
          if (seenIds.has(run.id)) continue;
          seenIds.add(run.id);

          if (
            where?.repositoryId?.in &&
            !where.repositoryId.in.includes(run.repositoryId)
          )
            continue;
          if (where?.status && run.status !== where.status) continue;
          if (where?.repository?.githubRepoId?.in) {
            const repo = Array.from(storage.repositories.values()).find(
              (r) => r.id === run.repositoryId,
            );
            if (!repo) continue;
            const inList = where.repository.githubRepoId.in.map((id: bigint) =>
              id.toString(),
            );
            if (!inList.includes(repo.githubRepoId.toString())) continue;
          }
          count++;
        }
        return count;
      },

      groupBy: async ({
        by,
        where,
      }: {
        by: string[];
        where?: any;
      }): Promise<any[]> => {
        const counts = new Map<string, number>();
        const seenIds = new Set<string>();
        for (const run of storage.reviewRuns.values()) {
          if (seenIds.has(run.id)) continue;
          seenIds.add(run.id);

          if (
            where?.repositoryId?.in &&
            !where.repositoryId.in.includes(run.repositoryId)
          )
            continue;
          const key = String((run as any)[by[0]]);
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        return Array.from(counts.entries()).map(([k, count]) => ({
          [by[0]]: k,
          _count: { [by[0]]: count },
        }));
      },

      findMany: async ({
        where,
        orderBy,
        skip = 0,
        take = 20,
        include,
      }: {
        where?: any;
        orderBy?: any;
        skip?: number;
        take?: number;
        include?: any;
      } = {}): Promise<any[]> => {
        const list: any[] = [];
        const seenIds = new Set<string>();
        for (const run of storage.reviewRuns.values()) {
          if (seenIds.has(run.id)) continue;
          seenIds.add(run.id);

          if (
            where?.repositoryId?.in &&
            !where.repositoryId.in.includes(run.repositoryId)
          )
            continue;
          if (
            typeof where?.repositoryId === "string" &&
            run.repositoryId !== where.repositoryId
          )
            continue;
          if (where?.status && run.status !== where.status) continue;
          if (where?.repository?.githubRepoId?.in) {
            const repo = Array.from(storage.repositories.values()).find(
              (r) => r.id === run.repositoryId,
            );
            if (!repo) continue;
            const inList = where.repository.githubRepoId.in.map((id: bigint) =>
              id.toString(),
            );
            if (!inList.includes(repo.githubRepoId.toString())) continue;
          }

          const item: any = { ...run };
          if (include?.repository) {
            const repo = Array.from(storage.repositories.values()).find(
              (r) => r.id === run.repositoryId,
            ) ?? {
              id: run.repositoryId,
              fullName: "unknown/repo",
              githubRepoId: 0n,
            };
            item.repository = repo;
          }
          list.push(item);
        }
        list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return list.slice(skip, skip + take);
      },
    },

    aIReviewExecution: {
      findUnique: async ({
        where,
      }: {
        where: { id?: string; reviewRunId?: string };
      }): Promise<AIReviewExecution | null> => {
        if (storage.shouldFail) {
          throw new Prisma.PrismaClientInitializationError(
            "Can't reach database server at `localhost:5432`",
            "7.10.1",
          );
        }
        if (where.id) {
          return storage.aiExecutions.get(where.id) ?? null;
        }
        if (where.reviewRunId) {
          for (const exec of storage.aiExecutions.values()) {
            if (exec.reviewRunId === where.reviewRunId) {
              return exec;
            }
          }
        }
        return null;
      },

      create: async ({
        data,
      }: {
        data: Prisma.AIReviewExecutionCreateInput;
      }): Promise<AIReviewExecution> => {
        if (storage.shouldFail) {
          throw new Prisma.PrismaClientInitializationError(
            "Can't reach database server at `localhost:5432`",
            "7.10.1",
          );
        }
        const id =
          (data as { id?: string }).id ??
          `aiexec-${Math.random().toString(36).substring(2, 10)}`;
        const reviewRunId =
          (data as { reviewRunId?: string }).reviewRunId ??
          data.reviewRun?.connect?.id ??
          "run-default";
        const record: AIReviewExecution = {
          id,
          reviewRunId,
          status:
            (data.status as AIExecutionStatus) ?? AIExecutionStatus.RUNNING,
          profile: data.profile,
          primaryModel: data.primaryModel,
          finalModel: data.finalModel ?? null,
          totalChunks: data.totalChunks ?? 0,
          completedChunks: data.completedChunks ?? 0,
          failedChunks: data.failedChunks ?? 0,
          skippedChunks: data.skippedChunks ?? 0,
          totalInputTokens: data.totalInputTokens ?? 0,
          totalOutputTokens: data.totalOutputTokens ?? 0,
          totalCandidatesGenerated: data.totalCandidatesGenerated ?? 0,
          totalCandidatesValidated: data.totalCandidatesValidated ?? 0,
          failureReason: data.failureReason ?? null,
          startedAt: new Date(),
          completedAt: null,
        };
        storage.aiExecutions.set(id, record);
        return record;
      },

      update: async ({
        where,
        data,
      }: {
        where: { id?: string; reviewRunId?: string };
        data: Prisma.AIReviewExecutionUpdateInput;
      }): Promise<AIReviewExecution> => {
        if (storage.shouldFail) {
          throw new Prisma.PrismaClientInitializationError(
            "Can't reach database server at `localhost:5432`",
            "7.10.1",
          );
        }
        let existing: AIReviewExecution | undefined;
        if (where.id) {
          existing = storage.aiExecutions.get(where.id);
        } else if (where.reviewRunId) {
          for (const exec of storage.aiExecutions.values()) {
            if (exec.reviewRunId === where.reviewRunId) {
              existing = exec;
              break;
            }
          }
        }
        if (!existing) {
          throw new Error("AIReviewExecution to update not found");
        }
        const updated: AIReviewExecution = {
          ...existing,
          ...(data as unknown as Partial<AIReviewExecution>),
        };
        storage.aiExecutions.set(updated.id, updated);
        return updated;
      },

      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { reviewRunId?: string; id?: string };
        create: Prisma.AIReviewExecutionCreateInput;
        update: Prisma.AIReviewExecutionUpdateInput;
      }): Promise<AIReviewExecution> => {
        let existing: AIReviewExecution | undefined;
        if (where.id) {
          existing = storage.aiExecutions.get(where.id);
        } else if (where.reviewRunId) {
          for (const exec of storage.aiExecutions.values()) {
            if (exec.reviewRunId === where.reviewRunId) {
              existing = exec;
              break;
            }
          }
        }
        if (existing) {
          const updated: AIReviewExecution = {
            ...existing,
            ...(update as unknown as Partial<AIReviewExecution>),
          };
          storage.aiExecutions.set(updated.id, updated);
          return updated;
        } else {
          const id =
            (create as { id?: string }).id ??
            `aiexec-${Math.random().toString(36).substring(2, 10)}`;
          const reviewRunId =
            (create as { reviewRunId?: string }).reviewRunId ??
            create.reviewRun?.connect?.id ??
            where.reviewRunId ??
            "run-default";
          const record: AIReviewExecution = {
            id,
            reviewRunId,
            status:
              (create.status as AIExecutionStatus) ?? AIExecutionStatus.RUNNING,
            profile: create.profile,
            primaryModel: create.primaryModel,
            finalModel: create.finalModel ?? null,
            totalChunks: create.totalChunks ?? 0,
            completedChunks: create.completedChunks ?? 0,
            failedChunks: create.failedChunks ?? 0,
            skippedChunks: create.skippedChunks ?? 0,
            totalInputTokens: create.totalInputTokens ?? 0,
            totalOutputTokens: create.totalOutputTokens ?? 0,
            totalCandidatesGenerated: create.totalCandidatesGenerated ?? 0,
            totalCandidatesValidated: create.totalCandidatesValidated ?? 0,
            failureReason: create.failureReason ?? null,
            startedAt: new Date(),
            completedAt: null,
          };
          storage.aiExecutions.set(id, record);
          return record;
        }
      },
    },

    aIReviewChunk: {
      create: async ({
        data,
      }: {
        data: Prisma.AIReviewChunkCreateInput;
      }): Promise<AIReviewChunk> => {
        const id =
          (data as { id?: string }).id ??
          `chunk-${Math.random().toString(36).substring(2, 10)}`;
        const executionId =
          (data as { executionId?: string }).executionId ??
          data.execution?.connect?.id ??
          "exec-default";
        const filePaths = Array.isArray(data.filePaths)
          ? (data.filePaths as string[])
          : [];
        const record: AIReviewChunk = {
          id,
          executionId,
          chunkIndex: data.chunkIndex,
          filePaths,
          modelId: data.modelId,
          status: (data.status as string) ?? "PENDING",
          inputTokens: data.inputTokens ?? 0,
          outputTokens: data.outputTokens ?? 0,
          error: data.error ?? null,
          createdAt: new Date(),
          completedAt: null,
        };
        storage.aiChunks.set(id, record);
        return record;
      },

      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Prisma.AIReviewChunkUpdateInput;
      }): Promise<AIReviewChunk> => {
        const existing = storage.aiChunks.get(where.id);
        if (!existing) throw new Error("Chunk not found");
        const updated: AIReviewChunk = {
          ...existing,
          ...(data as unknown as Partial<AIReviewChunk>),
        };
        storage.aiChunks.set(where.id, updated);
        return updated;
      },

      findMany: async ({
        where,
      }: {
        where?: { executionId?: string; status?: string };
      }): Promise<AIReviewChunk[]> => {
        const list: AIReviewChunk[] = [];
        for (const chunk of storage.aiChunks.values()) {
          if (where?.executionId && chunk.executionId !== where.executionId) {
            continue;
          }
          if (where?.status && chunk.status !== where.status) {
            continue;
          }
          list.push(chunk);
        }
        return list;
      },

      updateMany: async ({
        where,
        data,
      }: {
        where?: { executionId?: string; status?: string };
        data: Prisma.AIReviewChunkUpdateInput;
      }): Promise<{ count: number }> => {
        let count = 0;
        for (const [id, chunk] of storage.aiChunks.entries()) {
          if (where?.executionId && chunk.executionId !== where.executionId) {
            continue;
          }
          if (where?.status && chunk.status !== where.status) {
            continue;
          }
          storage.aiChunks.set(id, {
            ...chunk,
            ...(data as unknown as Partial<AIReviewChunk>),
          });
          count++;
        }
        return { count };
      },
    },

    aIInferenceAttempt: {
      create: async ({
        data,
      }: {
        data: Prisma.AIInferenceAttemptCreateInput;
      }): Promise<AIInferenceAttempt> => {
        const id =
          (data as { id?: string }).id ??
          `attempt-${Math.random().toString(36).substring(2, 10)}`;
        const chunkId =
          (data as { chunkId?: string }).chunkId ??
          data.chunk?.connect?.id ??
          "chunk-default";
        const record: AIInferenceAttempt = {
          id,
          chunkId,
          attemptNumber: data.attemptNumber,
          modelId: data.modelId,
          provider: data.provider,
          status: data.status,
          inputTokens: data.inputTokens ?? 0,
          outputTokens: data.outputTokens ?? 0,
          latencyMs: data.latencyMs ?? 0,
          errorCategory: data.errorCategory ?? null,
          errorMessage: data.errorMessage ?? null,
          createdAt: new Date(),
        };
        storage.aiAttempts.set(id, record);
        return record;
      },

      updateMany: async ({
        where,
        data,
      }: {
        where?: { chunkId?: string; status?: string };
        data: Prisma.AIInferenceAttemptUpdateInput;
      }): Promise<{ count: number }> => {
        let count = 0;
        for (const [id, attempt] of storage.aiAttempts.entries()) {
          if (where?.chunkId && attempt.chunkId !== where.chunkId) {
            continue;
          }
          if (where?.status && attempt.status !== where.status) {
            continue;
          }
          storage.aiAttempts.set(id, {
            ...attempt,
            ...(data as unknown as Partial<AIInferenceAttempt>),
          });
          count++;
        }
        return { count };
      },
    },

    user: {
      create: async ({
        data,
      }: {
        data: Prisma.UserCreateInput;
      }): Promise<User> => {
        const id =
          (data as { id?: string }).id ??
          `user-${Math.random().toString(36).substring(2, 10)}`;
        const record: User = {
          id,
          githubUserId:
            typeof data.githubUserId === "bigint"
              ? data.githubUserId
              : BigInt(data.githubUserId),
          githubLogin: data.githubLogin,
          avatarUrl: data.avatarUrl ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastLoginAt: data.lastLoginAt
            ? new Date(data.lastLoginAt as unknown as string)
            : null,
        };
        storage.users.set(id, record);
        return record;
      },
      findUnique: async ({
        where,
      }: {
        where: { id?: string; githubUserId?: bigint | number };
      }): Promise<User | null> => {
        if (where.id) return storage.users.get(where.id) ?? null;
        if (where.githubUserId != null) {
          const ghId = BigInt(where.githubUserId);
          for (const u of storage.users.values()) {
            if (u.githubUserId === ghId) return u;
          }
        }
        return null;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id?: string; githubUserId?: bigint | number };
        data: Prisma.UserUpdateInput;
      }): Promise<User> => {
        let existing: User | undefined;
        if (where.id) existing = storage.users.get(where.id);
        else if (where.githubUserId != null) {
          const ghId = BigInt(where.githubUserId);
          for (const u of storage.users.values()) {
            if (u.githubUserId === ghId) {
              existing = u;
              break;
            }
          }
        }
        if (!existing) throw new Error("User not found");
        const updated: User = {
          ...existing,
          ...(data as unknown as Partial<User>),
          updatedAt: new Date(),
        };
        storage.users.set(existing.id, updated);
        return updated;
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { githubUserId: bigint | number };
        create: Prisma.UserCreateInput;
        update: Prisma.UserUpdateInput;
      }): Promise<User> => {
        const ghId = BigInt(where.githubUserId);
        let found: User | undefined;
        for (const u of storage.users.values()) {
          if (u.githubUserId === ghId) {
            found = u;
            break;
          }
        }
        if (found) {
          const updated: User = {
            ...found,
            ...(update as unknown as Partial<User>),
            updatedAt: new Date(),
          };
          storage.users.set(found.id, updated);
          return updated;
        }
        const id =
          (create as { id?: string }).id ??
          `user-${Math.random().toString(36).substring(2, 10)}`;
        const record: User = {
          id,
          githubUserId: ghId,
          githubLogin: create.githubLogin,
          avatarUrl: create.avatarUrl ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastLoginAt: create.lastLoginAt
            ? new Date(create.lastLoginAt as unknown as string)
            : null,
        };
        storage.users.set(id, record);
        return record;
      },
    },

    session: {
      create: async ({
        data,
      }: {
        data: Prisma.SessionCreateInput;
      }): Promise<Session> => {
        const id =
          (data as { id?: string }).id ??
          `sess-${Math.random().toString(36).substring(2, 10)}`;
        const userId =
          (data as { userId?: string }).userId ??
          data.user?.connect?.id ??
          "user-default";
        const record: Session = {
          id,
          tokenHash: data.tokenHash,
          userId,
          encryptedGitHubAccessToken: data.encryptedGitHubAccessToken,
          githubTokenExpiresAt: data.githubTokenExpiresAt
            ? new Date(data.githubTokenExpiresAt as unknown as string)
            : null,
          expiresAt: new Date(data.expiresAt as unknown as string),
          lastUsedAt: new Date(),
          revokedAt: null,
          createdAt: new Date(),
        };
        storage.sessions.set(id, record);
        return record;
      },
      findUnique: async ({
        where,
        include,
      }: {
        where: { id?: string; tokenHash?: string };
        include?: { user?: boolean };
      }): Promise<(Session & { user?: User }) | null> => {
        let sess: Session | undefined;
        if (where.id) sess = storage.sessions.get(where.id);
        else if (where.tokenHash) {
          for (const s of storage.sessions.values()) {
            if (s.tokenHash === where.tokenHash) {
              sess = s;
              break;
            }
          }
        }
        if (!sess) return null;
        if (include?.user) {
          const user = storage.users.get(sess.userId);
          return { ...sess, user: user! };
        }
        return sess;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Prisma.SessionUpdateInput;
      }): Promise<Session> => {
        const existing = storage.sessions.get(where.id);
        if (!existing) throw new Error("Session not found");
        const updated: Session = {
          ...existing,
          ...(data as unknown as Partial<Session>),
        };
        storage.sessions.set(where.id, updated);
        return updated;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { tokenHash?: string; revokedAt?: null };
        data: Prisma.SessionUpdateInput;
      }): Promise<{ count: number }> => {
        let count = 0;
        for (const [id, s] of storage.sessions.entries()) {
          if (where.tokenHash && s.tokenHash !== where.tokenHash) continue;
          if (where.revokedAt === null && s.revokedAt !== null) continue;
          storage.sessions.set(id, {
            ...s,
            ...(data as unknown as Partial<Session>),
          });
          count++;
        }
        return { count };
      },
    },

    oAuthTransaction: {
      create: async ({
        data,
      }: {
        data: Prisma.OAuthTransactionCreateInput;
      }): Promise<OAuthTransaction> => {
        const id =
          (data as { id?: string }).id ??
          `oauth-${Math.random().toString(36).substring(2, 10)}`;
        const record: OAuthTransaction = {
          id,
          state: data.state,
          codeVerifier: data.codeVerifier,
          expiresAt: new Date(data.expiresAt as unknown as string),
          createdAt: new Date(),
        };
        storage.oauthTransactions.set(id, record);
        return record;
      },
      findUnique: async ({
        where,
      }: {
        where: { state: string };
      }): Promise<OAuthTransaction | null> => {
        for (const t of storage.oauthTransactions.values()) {
          if (t.state === where.state) return t;
        }
        return null;
      },
      delete: async ({
        where,
      }: {
        where: { state?: string; id?: string };
      }): Promise<OAuthTransaction> => {
        for (const [id, t] of storage.oauthTransactions.entries()) {
          if (
            (where.id && id === where.id) ||
            (where.state && t.state === where.state)
          ) {
            storage.oauthTransactions.delete(id);
            return t;
          }
        }
        throw new Error("OAuthTransaction not found");
      },
      deleteMany: async ({
        where,
      }: {
        where?: { state?: string };
      }): Promise<{ count: number }> => {
        let count = 0;
        for (const [id, t] of storage.oauthTransactions.entries()) {
          if (where?.state && t.state !== where.state) continue;
          storage.oauthTransactions.delete(id);
          count++;
        }
        return { count };
      },
    },

    userInstallationGrant: {
      createMany: async ({
        data,
      }: {
        data: Prisma.UserInstallationGrantCreateManyInput[];
      }): Promise<{ count: number }> => {
        for (const item of data) {
          const id =
            item.id ?? `uig-${Math.random().toString(36).substring(2, 10)}`;
          const record: UserInstallationGrant = {
            id,
            userId: item.userId,
            installationGithubId: BigInt(item.installationGithubId),
            accountLogin: item.accountLogin,
            accountType: item.accountType,
            accountAvatarUrl: item.accountAvatarUrl ?? null,
            refreshedAt: new Date(
              (item.refreshedAt as unknown as string) ?? Date.now(),
            ),
            expiresAt: new Date(item.expiresAt as unknown as string),
          };
          storage.userInstallationGrants.set(id, record);
        }
        return { count: data.length };
      },
      findMany: async ({
        where,
      }: {
        where?: { userId?: string; expiresAt?: { gt?: Date } };
      }): Promise<UserInstallationGrant[]> => {
        const list: UserInstallationGrant[] = [];
        for (const g of storage.userInstallationGrants.values()) {
          if (where?.userId && g.userId !== where.userId) continue;
          if (
            where?.expiresAt?.gt &&
            g.expiresAt.getTime() <= where.expiresAt.gt.getTime()
          )
            continue;
          list.push(g);
        }
        return list;
      },
      deleteMany: async ({
        where,
      }: {
        where?: { userId?: string };
      }): Promise<{ count: number }> => {
        let count = 0;
        for (const [id, g] of storage.userInstallationGrants.entries()) {
          if (where?.userId && g.userId !== where.userId) continue;
          storage.userInstallationGrants.delete(id);
          count++;
        }
        return { count };
      },
    },

    userRepositoryGrant: {
      createMany: async ({
        data,
      }: {
        data: Prisma.UserRepositoryGrantCreateManyInput[];
      }): Promise<{ count: number }> => {
        for (const item of data) {
          const id =
            item.id ?? `urg-${Math.random().toString(36).substring(2, 10)}`;
          const record: UserRepositoryGrant = {
            id,
            userId: item.userId,
            installationGithubId: BigInt(item.installationGithubId),
            repositoryGithubId: BigInt(item.repositoryGithubId),
            owner: item.owner,
            repoName: item.repoName,
            fullName: item.fullName,
            permissions: (item.permissions as Prisma.JsonValue) ?? null,
            refreshedAt: new Date(
              (item.refreshedAt as unknown as string) ?? Date.now(),
            ),
            expiresAt: new Date(item.expiresAt as unknown as string),
          };
          storage.userRepositoryGrants.set(id, record);
        }
        return { count: data.length };
      },
      findMany: async ({
        where,
      }: {
        where?: { userId?: string; expiresAt?: { gt?: Date } };
      }): Promise<UserRepositoryGrant[]> => {
        const list: UserRepositoryGrant[] = [];
        for (const g of storage.userRepositoryGrants.values()) {
          if (where?.userId && g.userId !== where.userId) continue;
          if (
            where?.expiresAt?.gt &&
            g.expiresAt.getTime() <= where.expiresAt.gt.getTime()
          )
            continue;
          list.push(g);
        }
        return list;
      },
      deleteMany: async ({
        where,
      }: {
        where?: { userId?: string };
      }): Promise<{ count: number }> => {
        let count = 0;
        for (const [id, g] of storage.userRepositoryGrants.entries()) {
          if (where?.userId && g.userId !== where.userId) continue;
          storage.userRepositoryGrants.delete(id);
          count++;
        }
        return { count };
      },
    },

    reviewFinding: {
      createMany: async ({
        data,
      }: {
        data: Prisma.ReviewFindingCreateManyInput[];
      }): Promise<{ count: number }> => {
        for (const item of data) {
          const id =
            item.id ?? `finding-${Math.random().toString(36).substring(2, 10)}`;
          const record: ReviewFinding = {
            id,
            reviewRunId: item.reviewRunId,
            fingerprint: item.fingerprint,
            provenance: item.provenance,
            ruleId: item.ruleId ?? null,
            modelId: item.modelId ?? null,
            category: item.category,
            severity: item.severity,
            title: item.title,
            description: item.description,
            recommendation: item.recommendation,
            confidence:
              item.confidence != null
                ? new Prisma.Decimal(item.confidence as number)
                : null,
            filePath: item.filePath ?? null,
            line: item.line ?? null,
            side: item.side ?? null,
            scope: item.scope,
            createdAt: new Date(),
          };
          storage.reviewFindings.set(id, record);
        }
        return { count: data.length };
      },
      findMany: async ({
        where,
      }: {
        where?: { reviewRunId?: string };
      }): Promise<ReviewFinding[]> => {
        const list: ReviewFinding[] = [];
        for (const f of storage.reviewFindings.values()) {
          if (where?.reviewRunId && f.reviewRunId !== where.reviewRunId)
            continue;
          list.push(f);
        }
        return list;
      },
      groupBy: async ({
        by,
        where,
      }: {
        by: string[];
        where?: any;
      }): Promise<any[]> => {
        const counts = new Map<string, number>();
        for (const f of storage.reviewFindings.values()) {
          if (where?.reviewRun?.repositoryId?.in) {
            let run: any = null;
            for (const r of storage.reviewRuns.values()) {
              if (r.id === f.reviewRunId) {
                run = r;
                break;
              }
            }
            if (
              !run ||
              !where.reviewRun.repositoryId.in.includes(run.repositoryId)
            )
              continue;
          }
          const key = String((f as any)[by[0]]);
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        return Array.from(counts.entries()).map(([k, count]) => ({
          [by[0]]: k,
          _count: { [by[0]]: count },
        }));
      },
    },
  };

  return client as unknown as MockPrismaClient;
}
