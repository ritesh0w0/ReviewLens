import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import {
  createMockPrismaClient,
  type MockPrismaClient,
} from "./mock-prisma.js";
import { FakeGitHubUserClient } from "../github/user-client.js";
import {
  encryptToken,
  decryptToken,
  hashSessionToken,
} from "../auth/crypto.js";
import { computeCodeChallenge } from "../auth/pkce.js";
import { SESSION_COOKIE_NAME } from "../auth/session-manager.js";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "../auth/csrf.js";

describe("M6 Authentication Flow and Session Management", () => {
  let mockPrisma: MockPrismaClient;
  let fakeUserClient: FakeGitHubUserClient;
  let app: ReturnType<typeof createApp>;
  const testKey = Buffer.alloc(32, 7); // 32 bytes test key
  const clientId = "test-client-id";
  const clientSecret = "test-client-secret";
  const callbackUrl = "http://localhost:3001/api/auth/github/callback";
  const frontendUrl = "http://localhost:5173";

  beforeEach(() => {
    process.env.SESSION_ENCRYPTION_KEY = testKey.toString("hex");
    process.env.NODE_ENV = "test";

    mockPrisma = createMockPrismaClient();
    fakeUserClient = new FakeGitHubUserClient();

    app = createApp({
      prisma: mockPrisma,
      userClient: fakeUserClient,
      clientId,
      clientSecret,
      callbackUrl,
      frontendUrl,
      trustedOrigins: [frontendUrl],
    });
  });

  describe("PKCE and Token Encryption Security", () => {
    it("encrypts and decrypts GitHub user access tokens using AES-256-GCM", () => {
      const originalToken = "ghu_SecretUserAccessToken12345";
      const encrypted = encryptToken(originalToken, testKey);

      expect(encrypted).not.toContain(originalToken);
      expect(encrypted.split(":")).toHaveLength(3); // iv:tag:ciphertext

      const decrypted = decryptToken(encrypted, testKey);
      expect(decrypted).toBe(originalToken);
    });

    it("fails decryption if auth tag is tampered with", () => {
      const originalToken = "ghu_SecretToken";
      const encrypted = encryptToken(originalToken, testKey);
      const [iv, tag, cipher] = encrypted.split(":");

      // Corrupt the ciphertext
      const corruptedCipher = "ff" + cipher!.slice(2);
      const tampered = `${iv}:${tag}:${corruptedCipher}`;

      expect(() => decryptToken(tampered, testKey)).toThrow();
    });

    it("computes S256 code challenge conforming to RFC 7636", () => {
      const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
      const challenge = computeCodeChallenge(verifier);
      expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    });
  });

  describe("GET /api/auth/github", () => {
    it("redirects to GitHub authorization endpoint with PKCE parameters", async () => {
      const res = await request(app).get("/api/auth/github");

      expect(res.status).toBe(302);
      const location = res.header.location;
      expect(location).toBeDefined();

      const url = new URL(location);
      expect(url.origin).toBe("https://github.com");
      expect(url.pathname).toBe("/login/oauth/authorize");
      expect(url.searchParams.get("client_id")).toBe(clientId);
      expect(url.searchParams.get("redirect_uri")).toBe(callbackUrl);
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      expect(url.searchParams.get("code_challenge")).toBeTruthy();

      const state = url.searchParams.get("state");
      expect(state).toBeTruthy();

      // Verify OAuthTransaction was stored in database
      const tx = await mockPrisma.oAuthTransaction.findUnique({
        where: { state: state! },
      });
      expect(tx).not.toBeNull();
      expect(tx?.codeVerifier).toBeTruthy();
    });
  });

  describe("GET /api/auth/github/callback", () => {
    it("rejects callback with missing code or state", async () => {
      const res = await request(app).get("/api/auth/github/callback");
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Missing code or state");
    });

    it("rejects callback with unknown or expired state", async () => {
      const res = await request(app)
        .get("/api/auth/github/callback")
        .query({ code: "code123", state: "non-existent-state" });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain(
        "Invalid or already consumed OAuth state",
      );
    });

    it("rejects replayed authorization transaction (single-use)", async () => {
      // 1. Initiate OAuth
      const initRes = await request(app).get("/api/auth/github");
      const url = new URL(initRes.header.location);
      const state = url.searchParams.get("state")!;

      // Setup fake response
      fakeUserClient.tokenResponses.set("auth-code-1", {
        access_token: "ghu_token_123",
        token_type: "bearer",
        expires_in: 28800,
      });
      fakeUserClient.users.set("ghu_token_123", {
        id: 9999,
        login: "octocat",
        avatar_url: "https://github.com/avatar.png",
      });

      // First callback consumes state
      const cb1 = await request(app)
        .get("/api/auth/github/callback")
        .query({ code: "auth-code-1", state });

      expect(cb1.status).toBe(302);

      // Replaying the same state immediately fails
      const cb2 = await request(app)
        .get("/api/auth/github/callback")
        .query({ code: "auth-code-1", state });

      expect(cb2.status).toBe(400);
      expect(cb2.body.error).toContain(
        "Invalid or already consumed OAuth state",
      );
    });

    it("successfully authenticates user, sets session cookie, and encrypts access token", async () => {
      // 1. Initiate OAuth
      const initRes = await request(app).get("/api/auth/github");
      const url = new URL(initRes.header.location);
      const state = url.searchParams.get("state")!;

      fakeUserClient.tokenResponses.set("valid-code", {
        access_token: "ghu_secure_access_token_abc",
        token_type: "bearer",
        expires_in: 3600,
      });
      fakeUserClient.users.set("ghu_secure_access_token_abc", {
        id: 123456,
        login: "test-user",
        avatar_url: "https://avatars.githubusercontent.com/u/123456",
      });

      // 2. Callback
      const cbRes = await request(app)
        .get("/api/auth/github/callback")
        .query({ code: "valid-code", state });

      expect(cbRes.status).toBe(302);
      expect(cbRes.header.location).toBe(`${frontendUrl}/`);

      // Check cookies
      const cookies = cbRes.header["set-cookie"] as unknown as string[];
      expect(cookies).toBeDefined();

      const sessionCookie = cookies.find((c: string) =>
        c.startsWith(`${SESSION_COOKIE_NAME}=`),
      );
      expect(sessionCookie).toBeDefined();
      expect(sessionCookie).toContain("HttpOnly");
      expect(sessionCookie).toContain("SameSite=Lax");

      // Verify User record in DB
      const user = await mockPrisma.user.findUnique({
        where: { githubUserId: 123456n },
      });
      expect(user).not.toBeNull();
      expect(user?.githubLogin).toBe("test-user");

      // Verify Session record in DB: access token must be encrypted, NEVER plaintext
      const sessions = Array.from(mockPrisma._storage.sessions.values());
      expect(sessions.length).toBeGreaterThan(0);
      const sess = sessions[0]!;
      expect(sess.encryptedGitHubAccessToken).not.toBe(
        "ghu_secure_access_token_abc",
      );
      expect(sess.encryptedGitHubAccessToken.split(":")).toHaveLength(3);

      // Decrypted token matches
      const decrypted = decryptToken(sess.encryptedGitHubAccessToken, testKey);
      expect(decrypted).toBe("ghu_secure_access_token_abc");
    });
  });

  describe("GET /api/auth/me", () => {
    it("returns 401 when no session cookie is supplied", async () => {
      const res = await request(app).get("/api/auth/me");
      expect(res.status).toBe(401);
      expect(res.body.authenticated).toBe(false);
    });

    it("returns safe profile for authenticated session without leaking tokens", async () => {
      const user = await mockPrisma.user.create({
        data: {
          githubUserId: 42n,
          githubLogin: "alice",
          avatarUrl: "https://alice.avatar",
        },
      });

      const rawSessionToken = "test-raw-session-token-123456789";
      const tokenHash = hashSessionToken(rawSessionToken);

      await mockPrisma.session.create({
        data: {
          tokenHash,
          userId: user.id,
          encryptedGitHubAccessToken: encryptToken("ghu_alice_token", testKey),
          expiresAt: new Date(Date.now() + 1000000),
        },
      });

      const res = await request(app)
        .get("/api/auth/me")
        .set("Cookie", `${SESSION_COOKIE_NAME}=${rawSessionToken}`);

      expect(res.status).toBe(200);
      expect(res.body.authenticated).toBe(true);
      expect(res.body.user.githubLogin).toBe("alice");
      expect(res.body.user.avatarUrl).toBe("https://alice.avatar");

      // Zero credential leakage
      expect(res.body.token).toBeUndefined();
      expect(res.body.accessToken).toBeUndefined();
      expect(res.body.user.tokenHash).toBeUndefined();
      expect(res.body.user.encryptedGitHubAccessToken).toBeUndefined();
    });
  });

  describe("CSRF Protection and Logout", () => {
    it("supplies a CSRF token via GET /api/auth/csrf", async () => {
      const res = await request(app).get("/api/auth/csrf");
      expect(res.status).toBe(200);
      expect(res.body.csrfToken).toBeDefined();

      const cookies = res.header["set-cookie"] as unknown as string[];
      const csrfCookie = cookies.find((c: string) =>
        c.startsWith(`${CSRF_COOKIE_NAME}=`),
      );
      expect(csrfCookie).toBeDefined();
    });

    it("rejects POST /api/auth/logout without CSRF token", async () => {
      const res = await request(app).post("/api/auth/logout");
      expect(res.status).toBe(403);
      expect(res.body.error).toContain("Missing CSRF token");
    });

    it("successfully logs out and revokes session when CSRF token is provided", async () => {
      const user = await mockPrisma.user.create({
        data: {
          githubUserId: 55n,
          githubLogin: "bob",
        },
      });

      const rawSessionToken = "bobs-active-session";
      const tokenHash = hashSessionToken(rawSessionToken);

      await mockPrisma.session.create({
        data: {
          tokenHash,
          userId: user.id,
          encryptedGitHubAccessToken: encryptToken("ghu_bob_token", testKey),
          expiresAt: new Date(Date.now() + 1000000),
        },
      });

      const csrfToken = "valid-csrf-token-123";

      const res = await request(app)
        .post("/api/auth/logout")
        .set("Origin", frontendUrl)
        .set("Cookie", [
          `${SESSION_COOKIE_NAME}=${rawSessionToken}`,
          `${CSRF_COOKIE_NAME}=${csrfToken}`,
        ])
        .set(CSRF_HEADER_NAME, csrfToken);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify session is revoked in database
      const sessionInDb = await mockPrisma.session.findUnique({
        where: { tokenHash },
      });
      expect(sessionInDb?.revokedAt).not.toBeNull();

      // Subsequent /api/auth/me call returns 401
      const meRes = await request(app)
        .get("/api/auth/me")
        .set("Cookie", `${SESSION_COOKIE_NAME}=${rawSessionToken}`);
      expect(meRes.status).toBe(401);
    });
  });
});
