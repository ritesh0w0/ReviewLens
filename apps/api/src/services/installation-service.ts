import {
  InstallationStatus,
  type PrismaClient,
} from "../generated/prisma/client.js";

export interface GitHubInstallationWebhookPayload {
  action: string;
  installation: {
    id: number;
    account?: {
      login?: string;
      type?: string;
    };
  };
  repositories?: Array<{
    id: number;
    name?: string;
    full_name: string;
    default_branch?: string;
  }>;
  repositories_added?: Array<{
    id: number;
    name?: string;
    full_name: string;
  }>;
  repositories_removed?: Array<{
    id: number;
    name?: string;
    full_name: string;
  }>;
}

export async function processInstallationLifecycle(
  prisma: PrismaClient,
  event: string,
  payload: GitHubInstallationWebhookPayload,
): Promise<{ processed: boolean; reason: string }> {
  const githubInstallationId = BigInt(payload.installation.id);

  if (event === "installation") {
    const action = payload.action;

    if (action === "created") {
      const accountLogin = payload.installation.account?.login ?? "unknown";
      const accountType = payload.installation.account?.type ?? "Organization";

      await prisma.$transaction(async (tx) => {
        const inst = await tx.installation.upsert({
          where: { githubInstallationId },
          create: {
            githubInstallationId,
            accountLogin,
            accountType,
            status: InstallationStatus.ACTIVE,
          },
          update: {
            accountLogin,
            accountType,
            status: InstallationStatus.ACTIVE,
          },
        });

        if (payload.repositories && payload.repositories.length > 0) {
          for (const repo of payload.repositories) {
            const githubRepoId = BigInt(repo.id);
            await tx.repository.upsert({
              where: { githubRepoId },
              create: {
                installationId: inst.id,
                githubRepoId,
                fullName: repo.full_name,
                defaultBranch: repo.default_branch ?? null,
                enabled: true,
              },
              update: {
                fullName: repo.full_name,
                enabled: true,
              },
            });
          }
        }
      });

      return { processed: true, reason: "Installation created" };
    }

    if (action === "suspend") {
      await prisma.installation.updateMany({
        where: { githubInstallationId },
        data: { status: InstallationStatus.SUSPENDED },
      });
      return { processed: true, reason: "Installation suspended" };
    }

    if (action === "unsuspend") {
      await prisma.installation.updateMany({
        where: { githubInstallationId },
        data: { status: InstallationStatus.ACTIVE },
      });
      return { processed: true, reason: "Installation unsuspended" };
    }

    if (action === "deleted") {
      await prisma.$transaction(async (tx) => {
        const inst = await tx.installation.findUnique({
          where: { githubInstallationId },
        });
        if (inst) {
          await tx.installation.update({
            where: { id: inst.id },
            data: { status: InstallationStatus.DELETED },
          });
          await tx.repository.updateMany({
            where: { installationId: inst.id },
            data: { enabled: false },
          });
        }
      });
      return { processed: true, reason: "Installation deleted" };
    }
  }

  if (event === "installation_repositories") {
    const action = payload.action;

    if (action === "added") {
      await prisma.$transaction(async (tx) => {
        const inst = await tx.installation.findUnique({
          where: { githubInstallationId },
        });
        if (!inst) return;

        if (
          payload.repositories_added &&
          payload.repositories_added.length > 0
        ) {
          for (const repo of payload.repositories_added) {
            const githubRepoId = BigInt(repo.id);
            await tx.repository.upsert({
              where: { githubRepoId },
              create: {
                installationId: inst.id,
                githubRepoId,
                fullName: repo.full_name,
                enabled: true,
              },
              update: {
                fullName: repo.full_name,
                enabled: true,
              },
            });
          }
        }
      });
      return { processed: true, reason: "Repositories added" };
    }

    if (action === "removed") {
      await prisma.$transaction(async (tx) => {
        if (
          payload.repositories_removed &&
          payload.repositories_removed.length > 0
        ) {
          for (const repo of payload.repositories_removed) {
            const githubRepoId = BigInt(repo.id);
            await tx.repository.updateMany({
              where: { githubRepoId },
              data: { enabled: false },
            });
          }
        }
      });
      return { processed: true, reason: "Repositories removed" };
    }
  }

  return {
    processed: false,
    reason: `Ignored event ${event} action ${payload.action}`,
  };
}
