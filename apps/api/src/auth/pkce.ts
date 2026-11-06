import crypto from "node:crypto";

/**
 * Encodes a buffer to base64url format (RFC 7636 Section 3).
 */
function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Generates a cryptographically random OAuth state string.
 */
export function generateOAuthState(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Generates a high-entropy PKCE code verifier (RFC 7636).
 * 32 random bytes base64url-encoded produces 43 characters.
 */
export function generateCodeVerifier(): string {
  return base64UrlEncode(crypto.randomBytes(32));
}

/**
 * Computes the S256 code challenge for a given code verifier.
 * code_challenge = BASE64URL(SHA256(code_verifier))
 */
export function computeCodeChallenge(codeVerifier: string): string {
  const hash = crypto.createHash("sha256").update(codeVerifier).digest();
  return base64UrlEncode(hash);
}
