import {
  type PrismaClient,
  type User,
  type Session,
  type UserInstallationGrant,
  type UserRepositoryGrant,
  Prisma,
} from "../generated/prisma/client.js";
import type { GitHubUserClient } from "../github/user-client.js";
import { getDecryptedGitHubAccessToken } from "../auth/session-manager.js";

export const GRANT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes freshness window

export interface UserAuthorizedGrants {
  installations: UserInstallationGrant[];
  repositories: UserRepositoryGrant[];
}

/**
 * Retrieves the installations and repositories authorized for a user.
 * Returns cached grants if fresh (< 5 mins), otherwise transparently refreshes
 * from GitHub using the user's decrypted access token.
 */
export async function getUserGrants(
  prisma: PrismaClient,
  userClient: GitHubUserClient,
  user: User,
  session: Session,
  forceRefresh = false,
): Promise<UserAuthorizedGrants> {
  const now = new Date();

  if (!forceRefresh) {
    const existingInstGrants = await prisma.userInstallationGrant.findMany({
      where: {
        userId: user.id,
        expiresAt: { gt: now },
      },
    });

    if (existingInstGrants.length > 0) {
      const existingRepoGrants = await prisma.userRepositoryGrant.findMany({
        where: {
          userId: user.id,
          expiresAt: { gt: now },
        },
      });

      return {
        installations: existingInstGrants,
        repositories: existingRepoGrants,
      };
    }
  }

  // Cache miss or expired: refresh from GitHub
  const accessToken = getDecryptedGitHubAccessToken(session);
  const expiresAt = new Date(now.getTime() + GRANT_CACHE_TTL_MS);

  const ghInstallations = await userClient.getUserInstallations(accessToken);

  const repoPromises = ghInstallations.map(async (inst) => {
    const repos = await userClient.getUserInstallationRepositories(
      accessToken,
      inst.id,
    );
    return { installationId: inst.id, repos };
  });

  const allRepoResults = await Promise.all(repoPromises);

  // Atomically replace cached grants in PostgreSQL
  const refreshedGrants = await prisma.$transaction(async (tx) => {
    // 1. Clear stale grants
    await tx.userRepositoryGrant.deleteMany({
      where: { userId: user.id },
    });
    await tx.userInstallationGrant.deleteMany({
      where: { userId: user.id },
    });

    // 2. Insert refreshed installation grants
    const instRecords = ghInstallations.map((inst) => ({
      userId: user.id,
      installationGithubId: BigInt(inst.id),
      accountLogin: inst.account.login,
      accountType: inst.account.type,
      accountAvatarUrl: inst.account.avatar_url,
      refreshedAt: now,
      expiresAt,
    }));

    if (instRecords.length > 0) {
      await tx.userInstallationGrant.createMany({
        data: instRecords,
      });
    }

    // 3. Insert refreshed repository grants (deduplicated by repositoryGithubId)
    const seenRepoIds = new Set<string>();
    const repoRecords: Prisma.UserRepositoryGrantCreateManyInput[] = [];

    for (const item of allRepoResults) {
      for (const repo of item.repos) {
        const repoIdStr = String(repo.id);
        if (seenRepoIds.has(repoIdStr)) continue;
        seenRepoIds.add(repoIdStr);

        repoRecords.push({
          userId: user.id,
          installationGithubId: BigInt(item.installationId),
          repositoryGithubId: BigInt(repo.id),
          owner: repo.owner.login,
          repoName: repo.name,
          fullName: repo.full_name,
          permissions: repo.permissions
            ? (repo.permissions as Prisma.InputJsonObject)
            : Prisma.JsonNull,
          refreshedAt: now,
          expiresAt,
        });
      }
    }

    if (repoRecords.length > 0) {
      await tx.userRepositoryGrant.createMany({
        data: repoRecords,
      });
    }

    const savedInsts = await tx.userInstallationGrant.findMany({
      where: { userId: user.id },
    });
    const savedRepos = await tx.userRepositoryGrant.findMany({
      where: { userId: user.id },
    });

    return {
      installations: savedInsts,
      repositories: savedRepos,
    };
  });

  return refreshedGrants;
}

/**
 * Checks whether an authenticated user has authorized access to a specific repository.
 */
export async function verifyUserHasRepositoryAccess(
  prisma: PrismaClient,
  userClient: GitHubUserClient,
  user: User,
  session: Session,
  githubRepoId: bigint | number,
): Promise<boolean> {
  const grants = await getUserGrants(prisma, userClient, user, session);
  const targetId = BigInt(githubRepoId);
  return grants.repositories.some((r) => r.repositoryGithubId === targetId);
}
