import { Router, type Request, type Response } from "express";
import type {
  PrismaClient,
  User,
  Session,
} from "../generated/prisma/client.js";
import {
  generateOAuthState,
  generateCodeVerifier,
  computeCodeChallenge,
} from "../auth/pkce.js";
import {
  createSession,
  validateSession,
  revokeSession,
  setSessionCookie,
  clearSessionCookie,
  SESSION_COOKIE_NAME,
} from "../auth/session-manager.js";
import {
  generateCsrfToken,
  setCsrfCookie,
  parseCookies,
  CSRF_COOKIE_NAME,
} from "../auth/csrf.js";
import { createRateLimiter } from "../auth/rate-limiter.js";
import type { GitHubUserClient } from "../github/user-client.js";
import { getUserGrants } from "../services/authorization-service.js";
import { timingSafeEqualString } from "../auth/crypto.js";

// Extend Express Request type to include user and session
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      session?: Session;
    }
  }
}

export interface AuthRoutesOptions {
  prisma: PrismaClient | (() => PrismaClient);
  userClient: GitHubUserClient;
  clientId?: string;
  clientSecret?: string;
  callbackUrl?: string;
  frontendUrl?: string;
}

export function createAuthRoutes(options: AuthRoutesOptions): Router {
  const router = Router();
  const prismaInput = options.prisma;
  const getPrisma = (): PrismaClient => {
    return typeof prismaInput === "function" ? prismaInput() : prismaInput;
  };
  const { userClient } = options;

  const authLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 30,
    message: "Too many authentication attempts. Please try again later.",
  });

  const clientId = options.clientId ?? process.env.GITHUB_CLIENT_ID;
  const clientSecret = options.clientSecret ?? process.env.GITHUB_CLIENT_SECRET;
  const callbackUrl =
    options.callbackUrl ??
    process.env.GITHUB_OAUTH_CALLBACK_URL ??
    "http://localhost:3001/api/auth/github/callback";
  const frontendUrl =
    options.frontendUrl ?? process.env.FRONTEND_URL ?? "http://localhost:5173";

  /**
   * GET /api/auth/github
   * Initiates the GitHub App user authorization flow with PKCE S256.
   */
  router.get("/github", authLimiter, async (req: Request, res: Response) => {
    if (!clientId) {
      return res.status(503).json({
        error: "GitHub App Client ID is not configured on the server",
      });
    }

    const state = generateOAuthState();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = computeCodeChallenge(codeVerifier);

    const now = Date.now();
    const expiresAt = new Date(now + 10 * 60 * 1000); // 10 minutes expiry

    // Save state and PKCE verifier to durable storage
    await getPrisma().oAuthTransaction.create({
      data: {
        state,
        codeVerifier,
        expiresAt,
      },
    });

    const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", callbackUrl);
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("code_challenge", codeChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");

    return res.redirect(authorizeUrl.toString());
  });

  /**
   * GET /api/auth/github/callback
   * Completes OAuth authorization code exchange with PKCE verification.
   */
  router.get(
    "/github/callback",
    authLimiter,
    async (req: Request, res: Response) => {
      const code = typeof req.query.code === "string" ? req.query.code : null;
      const state =
        typeof req.query.state === "string" ? req.query.state : null;

      if (!code || !state) {
        return res.status(400).json({
          error: "Missing code or state in OAuth callback",
        });
      }

      if (!clientId || !clientSecret) {
        return res.status(503).json({
          error: "GitHub OAuth credentials are not configured on the server",
        });
      }

      // 1. Validate state transaction
      const transaction = await getPrisma().oAuthTransaction.findUnique({
        where: { state },
      });

      if (!transaction) {
        return res.status(400).json({
          error: "Invalid or already consumed OAuth state",
        });
      }

      // Timing-safe state comparison
      if (!timingSafeEqualString(transaction.state, state)) {
        await getPrisma()
          .oAuthTransaction.delete({ where: { state } })
          .catch(() => {});
        return res.status(400).json({
          error: "OAuth state mismatch",
        });
      }

      // Check expiration
      if (transaction.expiresAt.getTime() <= Date.now()) {
        await getPrisma()
          .oAuthTransaction.delete({ where: { state } })
          .catch(() => {});
        return res.status(400).json({
          error: "OAuth transaction has expired",
        });
      }

      // Delete single-use transaction immediately to prevent replay
      await getPrisma().oAuthTransaction.delete({ where: { state } });

      // 2. Server-side token exchange with PKCE codeVerifier
      let tokenResponse;
      try {
        tokenResponse = await userClient.exchangeCodeForToken({
          clientId,
          clientSecret,
          code,
          redirectUri: callbackUrl,
          codeVerifier: transaction.codeVerifier,
        });
      } catch (err) {
        return res.status(400).json({
          error: `OAuth code exchange failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        });
      }

      // 3. Retrieve authenticated GitHub user identity
      let ghUser;
      try {
        ghUser = await userClient.getUserIdentity(tokenResponse.access_token);
      } catch (err) {
        return res.status(400).json({
          error: `Failed to fetch GitHub user identity: ${err instanceof Error ? err.message : "Unknown error"}`,
        });
      }

      // 4. Create or update ReviewLens user
      const user = await getPrisma().user.upsert({
        where: { githubUserId: BigInt(ghUser.id) },
        update: {
          githubLogin: ghUser.login,
          avatarUrl: ghUser.avatar_url,
          lastLoginAt: new Date(),
        },
        create: {
          githubUserId: BigInt(ghUser.id),
          githubLogin: ghUser.login,
          avatarUrl: ghUser.avatar_url,
          lastLoginAt: new Date(),
        },
      });

      // 5. Create new authenticated server session
      const { sessionToken, expiresAt, session } = await createSession(
        getPrisma(),
        {
          userId: user.id,
          githubAccessToken: tokenResponse.access_token,
          githubTokenExpiresInSec: tokenResponse.expires_in,
        },
      );

      // Set HTTP-only session cookie
      setSessionCookie(res, sessionToken, expiresAt);

      // Set CSRF token cookie for frontend
      const csrfToken = generateCsrfToken();
      setCsrfCookie(res, csrfToken);

      // 6. Pre-warm authorization grants cache asynchronously
      getUserGrants(getPrisma(), userClient, user, session).catch(() => {});

      // 7. Redirect to frontend dashboard
      return res.redirect(`${frontendUrl}/`);
    },
  );

  /**
   * GET /api/auth/me
   * Returns safe profile and authentication status of the signed-in user.
   */
  router.get("/me", async (req: Request, res: Response) => {
    const cookies = parseCookies(req.header("cookie"));
    const sessionToken = cookies[SESSION_COOKIE_NAME];

    if (!sessionToken) {
      return res.status(401).json({
        authenticated: false,
        error: "Unauthorized: No session token",
      });
    }

    const authContext = await validateSession(getPrisma(), sessionToken);
    if (!authContext) {
      clearSessionCookie(res);
      return res.status(401).json({
        authenticated: false,
        error: "Unauthorized: Session is invalid or expired",
      });
    }

    return res.status(200).json({
      authenticated: true,
      user: {
        id: authContext.user.id,
        githubLogin: authContext.user.githubLogin,
        avatarUrl: authContext.user.avatarUrl,
        createdAt: authContext.user.createdAt,
        lastLoginAt: authContext.user.lastLoginAt,
      },
    });
  });

  /**
   * GET /api/auth/csrf
   * Supplies the current CSRF token to the frontend client.
   */
  router.get("/csrf", (req: Request, res: Response) => {
    const cookies = parseCookies(req.header("cookie"));
    let csrfToken = cookies[CSRF_COOKIE_NAME];

    if (!csrfToken) {
      csrfToken = generateCsrfToken();
      setCsrfCookie(res, csrfToken);
    }

    return res.status(200).json({
      csrfToken,
    });
  });

  /**
   * POST /api/auth/logout
   * Revokes the active session and clears the session cookie.
   */
  router.post("/logout", async (req: Request, res: Response) => {
    const cookies = parseCookies(req.header("cookie"));
    const sessionToken = cookies[SESSION_COOKIE_NAME];

    if (sessionToken) {
      await revokeSession(getPrisma(), sessionToken);
    }

    clearSessionCookie(res);
    return res.status(200).json({
      success: true,
      message: "Successfully logged out",
    });
  });

  return router;
}
