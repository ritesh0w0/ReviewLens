import crypto from "node:crypto";
import type { Response } from "express";
import type {
  PrismaClient,
  User,
  Session,
} from "../generated/prisma/client.js";
import {
  encryptToken,
  decryptToken,
  hashSessionToken,
  getSessionEncryptionKey,
} from "./crypto.js";

export const SESSION_COOKIE_NAME = "reviewlens_session";
export const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface AuthenticatedContext {
  user: User;
  session: Session;
}

export interface CreateSessionParams {
  userId: string;
  githubAccessToken: string;
  githubTokenExpiresInSec?: number;
  encryptionKey?: Buffer;
}

export interface CreateSessionResult {
  sessionToken: string;
  expiresAt: Date;
  session: Session;
}

/**
 * Creates a new authenticated session for a user, encrypting the GitHub token at rest
 * and storing only the SHA-256 hash of the session token.
 */
export async function createSession(
  prisma: PrismaClient,
  params: CreateSessionParams,
): Promise<CreateSessionResult> {
  const sessionToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashSessionToken(sessionToken);

  const encKey = params.encryptionKey ?? getSessionEncryptionKey();
  const encryptedGitHubAccessToken = encryptToken(
    params.githubAccessToken,
    encKey,
  );

  const now = Date.now();
  const expiresAt = new Date(now + SESSION_LIFETIME_MS);
  const githubTokenExpiresAt = params.githubTokenExpiresInSec
    ? new Date(now + params.githubTokenExpiresInSec * 1000)
    : null;

  const session = await prisma.session.create({
    data: {
      tokenHash,
      userId: params.userId,
      encryptedGitHubAccessToken,
      githubTokenExpiresAt,
      expiresAt,
      lastUsedAt: new Date(now),
    },
  });

  return { sessionToken, expiresAt, session };
}

/**
 * Validates a session token from an incoming request cookie.
 * Returns null if token is missing, invalid, expired, or revoked.
 */
export async function validateSession(
  prisma: PrismaClient,
  sessionToken: string,
): Promise<AuthenticatedContext | null> {
  if (!sessionToken || typeof sessionToken !== "string") {
    return null;
  }

  const tokenHash = hashSessionToken(sessionToken);

  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!session) {
    return null;
  }

  // Reject revoked sessions
  if (session.revokedAt !== null) {
    return null;
  }

  // Reject expired ReviewLens sessions
  if (session.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  // Update lastUsedAt asynchronously
  prisma.session
    .update({
      where: { id: session.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {});

  return {
    user: session.user,
    session,
  };
}

/**
 * Revokes a session upon user logout.
 */
export async function revokeSession(
  prisma: PrismaClient,
  sessionToken: string,
): Promise<void> {
  if (!sessionToken) return;
  const tokenHash = hashSessionToken(sessionToken);

  await prisma.session.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Decrypts the GitHub user access token associated with an active session.
 */
export function getDecryptedGitHubAccessToken(
  session: Session,
  key?: Buffer,
): string {
  const encKey = key ?? getSessionEncryptionKey();
  return decryptToken(session.encryptedGitHubAccessToken, encKey);
}

/**
 * Attaches the session cookie to an Express Response.
 */
export function setSessionCookie(
  res: Response,
  sessionToken: string,
  expiresAt: Date,
): void {
  const isProduction = process.env.NODE_ENV === "production";
  const cookiePath = process.env.COOKIE_PATH || "/";
  res.cookie(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: cookiePath,
    expires: expiresAt,
  });
}

/**
 * Clears the session cookie on an Express Response.
 */
export function clearSessionCookie(res: Response): void {
  const isProduction = process.env.NODE_ENV === "production";
  const cookiePath = process.env.COOKIE_PATH || "/";
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: cookiePath,
  });
}
