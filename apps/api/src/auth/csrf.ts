import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { timingSafeEqualString } from "./crypto.js";

export const CSRF_COOKIE_NAME = "reviewlens_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";

/**
 * Generates a cryptographically random CSRF token.
 */
export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Sets the CSRF cookie on an Express response.
 * Note: httpOnly is false so that frontend client code can read and echo it in the header.
 */
export function setCsrfCookie(res: Response, token: string): void {
  const isProduction = process.env.NODE_ENV === "production";
  const cookiePath = process.env.COOKIE_PATH || "/";
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    sameSite: "lax",
    secure: isProduction,
    path: cookiePath,
  });
}

/**
 * Helper to parse cookies from the raw Cookie header.
 */
export function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  const pairs = cookieHeader.split(";");
  for (const pair of pairs) {
    const idx = pair.indexOf("=");
    if (idx > 0) {
      const key = pair.substring(0, idx).trim();
      const val = pair.substring(idx + 1).trim();
      cookies[key] = decodeURIComponent(val);
    }
  }
  return cookies;
}

/**
 * Validates Origin/Referer header against configured trusted frontend origins.
 */
export function validateOrigin(
  req: Request,
  trustedOrigins: string[],
): boolean {
  if (trustedOrigins.length === 0) return true;

  const origin = req.header("origin");
  if (origin) {
    return trustedOrigins.some(
      (trusted) => origin.toLowerCase() === trusted.toLowerCase(),
    );
  }

  const referer = req.header("referer");
  if (referer) {
    try {
      const url = new URL(referer);
      const refererOrigin = `${url.protocol}//${url.host}`;
      return trustedOrigins.some(
        (trusted) => refererOrigin.toLowerCase() === trusted.toLowerCase(),
      );
    } catch {
      return false;
    }
  }

  // If neither origin nor referer is provided, allow in non-production, but reject in production
  return process.env.NODE_ENV !== "production";
}

/**
 * Express middleware to enforce CSRF token and origin checks on state-changing requests.
 */
export function csrfProtection(trustedOrigins: string[] = []) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Skip CSRF validation for safe HTTP read methods
    const safeMethods = ["GET", "HEAD", "OPTIONS"];
    if (safeMethods.includes(req.method)) {
      return next();
    }

    // Skip webhooks (they are signed with HMAC-SHA256)
    if (req.path.startsWith("/webhooks")) {
      return next();
    }

    // 1. Origin verification
    if (!validateOrigin(req, trustedOrigins)) {
      return res.status(403).json({
        error: "Forbidden: Origin verification failed",
      });
    }

    // 2. Token verification
    const cookies = parseCookies(req.header("cookie"));
    const cookieToken = cookies[CSRF_COOKIE_NAME];
    const headerToken = req.header(CSRF_HEADER_NAME);

    if (!cookieToken || !headerToken) {
      return res.status(403).json({
        error: "Forbidden: Missing CSRF token",
      });
    }

    if (!timingSafeEqualString(cookieToken, headerToken)) {
      return res.status(403).json({
        error: "Forbidden: Invalid CSRF token",
      });
    }

    next();
  };
}
