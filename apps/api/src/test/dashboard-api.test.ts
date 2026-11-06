import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import {
  createMockPrismaClient,
  type MockPrismaClient,
} from "./mock-prisma.js";
import { FakeGitHubUserClient } from "../github/user-client.js";
import { encryptToken, hashSessionToken } from "../auth/crypto.js";
import { SESSION_COOKIE_NAME } from "../auth/session-manager.js";
import {
  ReviewStatus,
  ReviewTrigger,
  type User,
  type Repository,
  type ReviewRun,
} from "../generated/prisma/client.js";

describe("M6 Dashboard and Review APIs", () => {
  let mockPrisma: MockPrismaClient;
  let fakeUserClient: FakeGitHubUserClient;
  let app: ReturnType<typeof createApp>;
  const testKey = Buffer.alloc(32, 5);

  const rawSessionToken = "authorized-session-token-xyz";
  const userToken = "ghu_user_token_777";

  let testUser: User;
  let authorizedRepo: Repository;
  let unauthorizedRepo: Repository;
  let authorizedRun: ReviewRun;
  let unauthorizedRun: ReviewRun;

  beforeEach(async () => {
    process.env.SESSION_ENCRYPTION_KEY = testKey.toString("hex");
    process.env.NODE_ENV = "test";

    mockPrisma = createMockPrismaClient();
    fakeUserClient = new FakeGitHubUserClient();

    app = createApp({
      prisma: mockPrisma,
      userClient: fakeUserClient,
      clientId: "client-id",
      clientSecret: "client-secret",
    });

    // 1. Create User & Session
    testUser = await mockPrisma.user.create({
      data: {
        githubUserId: 777n,
        githubLogin: "developer-dan",
      },
    });

    await mockPrisma.session.create({
      data: {
        tokenHash: hashSessionToken(rawSessionToken),
        userId: testUser.id,
        encryptedGitHubAccessToken: encryptToken(userToken, testKey),
        expiresAt: new Date(Date.now() + 1000000),
      },
    });

    // 2. Configure GitHub user grants for User
    fakeUserClient.installations.set(userToken, [
      {
        id: 100,
        account: {
          login: "team-acme",
          type: "Organization",
          avatar_url: "https://avatar.acme.com",
        },
      },
    ]);

    fakeUserClient.repositories.set(`${userToken}:100`, [
      {
        id: 1001,
        name: "authorized-repo",
        full_name: "team-acme/authorized-repo",
        owner: { login: "team-acme" },
        private: false,
        permissions: { admin: true, push: true, pull: true },
      },
    ]);

    // 3. Database Records: Installation & Repositories
    const inst = await mockPrisma.installation.create({
      data: {
        githubInstallationId: 100n,
        accountLogin: "team-acme",
        accountType: "Organization",
      },
    });

    authorizedRepo = await mockPrisma.repository.create({
      data: {
        installationId: inst.id,
        githubRepoId: 1001n,
        fullName: "team-acme/authorized-repo",
      },
    });

    unauthorizedRepo = await mockPrisma.repository.create({
      data: {
        installationId: inst.id,
        githubRepoId: 9999n, // NOT in user's GitHub grants!
        fullName: "team-acme/secret-internal-repo",
      },
    });

    // 4. Create ReviewRuns
    authorizedRun = await mockPrisma.reviewRun.create({
      data: {
        repositoryId: authorizedRepo.id,
        prNumber: 42,
        headSha: "head1234",
        baseSha: "base1234",
        status: ReviewStatus.SUCCEEDED,
        trigger: ReviewTrigger.WEBHOOK,
        filesTotal: 3,
        filesReviewed: 3,
        candidateCount: 1,
        postedCount: 1,
      },
    });

    unauthorizedRun = await mockPrisma.reviewRun.create({
      data: {
        repositoryId: unauthorizedRepo.id,
        prNumber: 99,
        headSha: "secret123",
        baseSha: "base123",
        status: ReviewStatus.SUCCEEDED,
        trigger: ReviewTrigger.WEBHOOK,
        filesTotal: 10,
        filesReviewed: 10,
        candidateCount: 5,
        postedCount: 5,
      },
    });

    // 5. Findings for authorized run
    await mockPrisma.reviewFinding.createMany({
      data: [
        {
          reviewRunId: authorizedRun.id,
          fingerprint: "fp-sql-inj-01",
          provenance: "ai",
          modelId: "gemini-3.5-flash-lite",
          category: "security",
          severity: "HIGH",
          title: "SQL Injection",
          description: "Raw concatenation in query",
          recommendation: "Use parameterized queries",
          confidence: 0.95,
          filePath: "src/db.ts",
          line: 12,
          side: "RIGHT",
          scope: "line",
        },
      ],
    });

    // 6. AI Execution for authorized run
    const exec = await mockPrisma.aIReviewExecution.create({
      data: {
        reviewRunId: authorizedRun.id,
        status: "COMPLETE",
        profile: "development",
        primaryModel: "gemini-3.5-flash-lite",
        totalChunks: 1,
        completedChunks: 1,
        totalInputTokens: 500,
        totalOutputTokens: 120,
      },
    });

    await mockPrisma.aIReviewChunk.create({
      data: {
        executionId: exec.id,
        chunkIndex: 0,
        filePaths: ["src/db.ts"],
        modelId: "gemini-3.5-flash-lite",
        status: "COMPLETED",
        inputTokens: 500,
        outputTokens: 120,
      },
    });
  });

  describe("Unauthenticated Access Protection", () => {
    it("returns 401 for unauthenticated requests to protected endpoints", async () => {
      const endpoints = [
        "/api/installations",
        "/api/repositories",
        "/api/dashboard/overview",
        "/api/reviews",
        `/api/reviews/${authorizedRun.id}`,
        `/api/reviews/${authorizedRun.id}/findings`,
        `/api/reviews/${authorizedRun.id}/execution`,
      ];

      for (const ep of endpoints) {
        const res = await request(app).get(ep);
        expect(res.status).toBe(401);
        expect(res.body.error).toContain("Unauthorized");
      }
    });
  });

  describe("GET /api/installations", () => {
    it("returns user's accessible installations with repository counts", async () => {
      const res = await request(app)
        .get("/api/installations")
        .set("Cookie", `${SESSION_COOKIE_NAME}=${rawSessionToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].accountLogin).toBe("team-acme");
      expect(res.body[0].repositoryCount).toBe(1);
    });
  });

  describe("GET /api/repositories", () => {
    it("returns only repositories authorized to the user", async () => {
      const res = await request(app)
        .get("/api/repositories")
        .set("Cookie", `${SESSION_COOKIE_NAME}=${rawSessionToken}`);

      expect(res.status).toBe(200);
      expect(res.body.repositories).toHaveLength(1);
      expect(res.body.repositories[0].fullName).toBe(
        "team-acme/authorized-repo",
      );
      expect(res.body.repositories[0].totalReviews).toBe(1);
    });
  });

  describe("GET /api/dashboard/overview", () => {
    it("aggregates review metrics strictly across authorized repositories", async () => {
      const res = await request(app)
        .get("/api/dashboard/overview")
        .set("Cookie", `${SESSION_COOKIE_NAME}=${rawSessionToken}`);

      expect(res.status).toBe(200);
      // Total reviews must only count authorized runs (1), NEVER the unauthorized run (99)
      expect(res.body.totalReviews).toBe(1);
      expect(res.body.totalRepositories).toBe(1);
      expect(res.body.findingsBySeverity.HIGH).toBe(1);

      expect(res.body.recentReviews).toHaveLength(1);
      expect(res.body.recentReviews[0].prNumber).toBe(42);
    });
  });

  describe("GET /api/reviews", () => {
    it("returns review history filtered to authorized repositories", async () => {
      const res = await request(app)
        .get("/api/reviews")
        .set("Cookie", `${SESSION_COOKIE_NAME}=${rawSessionToken}`);

      expect(res.status).toBe(200);
      expect(res.body.reviews).toHaveLength(1);
      expect(res.body.reviews[0].prNumber).toBe(42);
      expect(res.body.reviews[0].repository.fullName).toBe(
        "team-acme/authorized-repo",
      );
    });
  });

  describe("GET /api/reviews/:id (Authorization enforcement)", () => {
    it("returns review details for an authorized review run", async () => {
      const res = await request(app)
        .get(`/api/reviews/${authorizedRun.id}`)
        .set("Cookie", `${SESSION_COOKIE_NAME}=${rawSessionToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(authorizedRun.id);
      expect(res.body.prNumber).toBe(42);
    });

    it("returns 404 safe error for an unauthorized review run", async () => {
      const res = await request(app)
        .get(`/api/reviews/${unauthorizedRun.id}`)
        .set("Cookie", `${SESSION_COOKIE_NAME}=${rawSessionToken}`);

      // Safe 404 anti-enumeration response
      expect(res.status).toBe(404);
      expect(res.body.error).toContain("Review not found");
    });
  });

  describe("GET /api/reviews/:id/findings", () => {
    it("returns validated findings for authorized review run", async () => {
      const res = await request(app)
        .get(`/api/reviews/${authorizedRun.id}/findings`)
        .set("Cookie", `${SESSION_COOKIE_NAME}=${rawSessionToken}`);

      expect(res.status).toBe(200);
      expect(res.body.findings).toHaveLength(1);
      expect(res.body.findings[0].title).toBe("SQL Injection");
      expect(res.body.findings[0].severity).toBe("HIGH");
      expect(res.body.findings[0].filePath).toBe("src/db.ts");
    });

    it("returns 404 for unauthorized review run findings", async () => {
      const res = await request(app)
        .get(`/api/reviews/${unauthorizedRun.id}/findings`)
        .set("Cookie", `${SESSION_COOKIE_NAME}=${rawSessionToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/reviews/:id/execution", () => {
    it("returns safe AI execution telemetry without prompt or diff leakage", async () => {
      const res = await request(app)
        .get(`/api/reviews/${authorizedRun.id}/execution`)
        .set("Cookie", `${SESSION_COOKIE_NAME}=${rawSessionToken}`);

      expect(res.status).toBe(200);
      expect(res.body.available).toBe(true);
      expect(res.body.status).toBe("COMPLETE");
      expect(res.body.primaryModel).toBe("gemini-3.5-flash-lite");
      expect(res.body.totalInputTokens).toBe(500);

      // Verify zero prompt or code leakage
      expect(res.body.prompt).toBeUndefined();
      expect(res.body.diff).toBeUndefined();
    });
  });
});
