import { describe, it, expect, beforeEach } from "vitest";
import {
  createMockPrismaClient,
  type MockPrismaClient,
} from "./mock-prisma.js";
import { FakeGitHubUserClient } from "../github/user-client.js";
import {
  getUserGrants,
  verifyUserHasRepositoryAccess,
} from "../services/authorization-service.js";
import { encryptToken } from "../auth/crypto.js";
import type { User, Session } from "../generated/prisma/client.js";

describe("M6 Authorization and Grant Management", () => {
  let mockPrisma: MockPrismaClient;
  let fakeUserClient: FakeGitHubUserClient;
  const testKey = Buffer.alloc(32, 9);

  let userA: User;
  let sessionA: Session;
  let userB: User;
  let sessionB: Session;

  beforeEach(async () => {
    process.env.SESSION_ENCRYPTION_KEY = testKey.toString("hex");

    mockPrisma = createMockPrismaClient();
    fakeUserClient = new FakeGitHubUserClient();

    // Create User A
    userA = await mockPrisma.user.create({
      data: {
        githubUserId: 101n,
        githubLogin: "alice",
      },
    });

    sessionA = await mockPrisma.session.create({
      data: {
        tokenHash: "hash-a",
        userId: userA.id,
        encryptedGitHubAccessToken: encryptToken("ghu_token_alice", testKey),
        expiresAt: new Date(Date.now() + 1000000),
      },
    });

    // Create User B
    userB = await mockPrisma.user.create({
      data: {
        githubUserId: 202n,
        githubLogin: "bob",
      },
    });

    sessionB = await mockPrisma.session.create({
      data: {
        tokenHash: "hash-b",
        userId: userB.id,
        encryptedGitHubAccessToken: encryptToken("ghu_token_bob", testKey),
        expiresAt: new Date(Date.now() + 1000000),
      },
    });
  });

  describe("Installation & Repository Discovery", () => {
    it("discovers accessible installations and repositories for a user", async () => {
      // Setup GitHub responses for User A
      fakeUserClient.installations.set("ghu_token_alice", [
        {
          id: 1111,
          account: {
            login: "org-alpha",
            type: "Organization",
            avatar_url: "https://org-alpha.png",
          },
        },
      ]);

      fakeUserClient.repositories.set("ghu_token_alice:1111", [
        {
          id: 5001,
          name: "repo-one",
          full_name: "org-alpha/repo-one",
          owner: { login: "org-alpha" },
          private: false,
          permissions: { admin: true, push: true, pull: true },
        },
        {
          id: 5002,
          name: "repo-two",
          full_name: "org-alpha/repo-two",
          owner: { login: "org-alpha" },
          private: true,
          permissions: { admin: false, push: true, pull: true },
        },
      ]);

      const grants = await getUserGrants(
        mockPrisma,
        fakeUserClient,
        userA,
        sessionA,
      );

      expect(grants.installations).toHaveLength(1);
      expect(grants.installations[0]?.accountLogin).toBe("org-alpha");
      expect(grants.installations[0]?.installationGithubId).toBe(1111n);

      expect(grants.repositories).toHaveLength(2);
      expect(grants.repositories[0]?.fullName).toBe("org-alpha/repo-one");
      expect(grants.repositories[1]?.fullName).toBe("org-alpha/repo-two");

      // Verify cached in DB
      const dbInstGrants = await mockPrisma.userInstallationGrant.findMany({
        where: { userId: userA.id },
      });
      expect(dbInstGrants).toHaveLength(1);

      const dbRepoGrants = await mockPrisma.userRepositoryGrant.findMany({
        where: { userId: userA.id },
      });
      expect(dbRepoGrants).toHaveLength(2);
    });

    it("enforces cross-user isolation: User B cannot see User A's repositories", async () => {
      // User A has access to 5001
      fakeUserClient.installations.set("ghu_token_alice", [
        {
          id: 1111,
          account: {
            login: "org-alpha",
            type: "Organization",
            avatar_url: null,
          },
        },
      ]);
      fakeUserClient.repositories.set("ghu_token_alice:1111", [
        {
          id: 5001,
          name: "repo-one",
          full_name: "org-alpha/repo-one",
          owner: { login: "org-alpha" },
          private: false,
        },
      ]);

      // User B only has access to 6001
      fakeUserClient.installations.set("ghu_token_bob", [
        {
          id: 2222,
          account: {
            login: "org-beta",
            type: "Organization",
            avatar_url: null,
          },
        },
      ]);
      fakeUserClient.repositories.set("ghu_token_bob:2222", [
        {
          id: 6001,
          name: "repo-secret",
          full_name: "org-beta/repo-secret",
          owner: { login: "org-beta" },
          private: true,
        },
      ]);

      await getUserGrants(mockPrisma, fakeUserClient, userA, sessionA);
      await getUserGrants(mockPrisma, fakeUserClient, userB, sessionB);

      // Verify User A has access to 5001, but NOT 6001
      const aHasRepo1 = await verifyUserHasRepositoryAccess(
        mockPrisma,
        fakeUserClient,
        userA,
        sessionA,
        5001,
      );
      expect(aHasRepo1).toBe(true);

      const aHasRepoSecret = await verifyUserHasRepositoryAccess(
        mockPrisma,
        fakeUserClient,
        userA,
        sessionA,
        6001,
      );
      expect(aHasRepoSecret).toBe(false);

      // Verify User B has access to 6001, but NOT 5001
      const bHasRepo1 = await verifyUserHasRepositoryAccess(
        mockPrisma,
        fakeUserClient,
        userB,
        sessionB,
        5001,
      );
      expect(bHasRepo1).toBe(false);

      const bHasRepoSecret = await verifyUserHasRepositoryAccess(
        mockPrisma,
        fakeUserClient,
        userB,
        sessionB,
        6001,
      );
      expect(bHasRepoSecret).toBe(true);
    });

    it("serves from cache if grants are fresh (< 5 mins)", async () => {
      fakeUserClient.installations.set("ghu_token_alice", [
        {
          id: 1111,
          account: {
            login: "org-alpha",
            type: "Organization",
            avatar_url: null,
          },
        },
      ]);
      fakeUserClient.repositories.set("ghu_token_alice:1111", [
        {
          id: 5001,
          name: "repo-one",
          full_name: "org-alpha/repo-one",
          owner: { login: "org-alpha" },
          private: false,
        },
      ]);

      // First call fetches from GitHub
      await getUserGrants(mockPrisma, fakeUserClient, userA, sessionA);

      // Mutate fake GitHub to empty
      fakeUserClient.repositories.set("ghu_token_alice:1111", []);

      // Second call within TTL should return from cache
      const cached = await getUserGrants(
        mockPrisma,
        fakeUserClient,
        userA,
        sessionA,
      );
      expect(cached.repositories).toHaveLength(1);
      expect(cached.repositories[0]?.fullName).toBe("org-alpha/repo-one");
    });

    it("refreshes grants and purges revoked repositories when cache expires", async () => {
      fakeUserClient.installations.set("ghu_token_alice", [
        {
          id: 1111,
          account: {
            login: "org-alpha",
            type: "Organization",
            avatar_url: null,
          },
        },
      ]);
      fakeUserClient.repositories.set("ghu_token_alice:1111", [
        {
          id: 5001,
          name: "repo-one",
          full_name: "org-alpha/repo-one",
          owner: { login: "org-alpha" },
          private: false,
        },
        {
          id: 5002,
          name: "repo-two",
          full_name: "org-alpha/repo-two",
          owner: { login: "org-alpha" },
          private: false,
        },
      ]);

      await getUserGrants(mockPrisma, fakeUserClient, userA, sessionA);

      // Now User A's access to 5002 is revoked on GitHub
      fakeUserClient.repositories.set("ghu_token_alice:1111", [
        {
          id: 5001,
          name: "repo-one",
          full_name: "org-alpha/repo-one",
          owner: { login: "org-alpha" },
          private: false,
        },
      ]);

      // Force refresh (simulating cache expiration)
      const refreshed = await getUserGrants(
        mockPrisma,
        fakeUserClient,
        userA,
        sessionA,
        true, // forceRefresh
      );

      expect(refreshed.repositories).toHaveLength(1);
      expect(refreshed.repositories[0]?.repositoryGithubId).toBe(5001n);

      // Revoked repository 5002 is immediately inaccessible
      const canAccess5002 = await verifyUserHasRepositoryAccess(
        mockPrisma,
        fakeUserClient,
        userA,
        sessionA,
        5002,
      );
      expect(canAccess5002).toBe(false);
    });
  });
});
