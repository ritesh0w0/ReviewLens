import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits standard for GCM
const TAG_LENGTH = 16; // 128 bits standard for GCM

/**
 * Retrieves the 32-byte encryption key for GitHub user access tokens.
 * Key must be configured via SESSION_ENCRYPTION_KEY (hex or raw 32 bytes).
 */
export function getSessionEncryptionKey(): Buffer {
  const rawKey = process.env.SESSION_ENCRYPTION_KEY;
  if (!rawKey) {
    throw new Error(
      "SESSION_ENCRYPTION_KEY environment variable is required for user session security",
    );
  }

  // Support 64-char hex string (32 bytes) or 32-char string / base64
  if (rawKey.length === 64 && /^[0-9a-fA-F]+$/.test(rawKey)) {
    return Buffer.from(rawKey, "hex");
  }

  const buf = Buffer.from(rawKey, "utf-8");
  if (buf.length === 32) {
    return buf;
  }

  // Also check if base64 encoded 32 bytes
  const b64Buf = Buffer.from(rawKey, "base64");
  if (b64Buf.length === 32) {
    return b64Buf;
  }

  throw new Error(
    `SESSION_ENCRYPTION_KEY must be exactly 32 bytes (got ${buf.length} bytes)`,
  );
}

/**
 * Encrypts a plaintext string (e.g. GitHub user access token) using AES-256-GCM.
 * Output format: iv_hex:tag_hex:ciphertext_hex
 */
export function encryptToken(plaintext: string, key?: Buffer): string {
  const encKey = key ?? getSessionEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, encKey, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${tag.toString("hex")}:${ciphertext.toString("hex")}`;
}

/**
 * Decrypts a token encrypted with encryptToken.
 * Throws if auth tag verification fails or format is invalid.
 */
export function decryptToken(encrypted: string, key?: Buffer): string {
  const encKey = key ?? getSessionEncryptionKey();
  const parts = encrypted.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted token format");
  }

  const [ivHex, tagHex, cipherHex] = parts;
  if (!ivHex || !tagHex || !cipherHex) {
    throw new Error("Malformed encrypted token payload");
  }

  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const ciphertext = Buffer.from(cipherHex, "hex");

  if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) {
    throw new Error("Invalid IV or authentication tag length");
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, encKey, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

/**
 * Hashes an opaque session token using SHA-256 for persistent database storage.
 */
export function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Timing-safe string comparison to prevent timing side-channel attacks.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") {
    return false;
  }
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}
