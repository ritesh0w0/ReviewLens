import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadFileSecrets } from "../config/secrets.js";

describe("File Secrets Loader", () => {
  let tempDir: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-secrets-test-"));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("populates process.env from _FILE when base env var is not set", () => {
    const secretPath = path.join(tempDir, "db_secret.txt");
    fs.writeFileSync(
      secretPath,
      "postgresql://user:pass@127.0.0.1:5432/testdb\n",
      "utf8",
    );

    delete process.env.DATABASE_URL;
    process.env.DATABASE_URL_FILE = secretPath;

    loadFileSecrets();

    expect(process.env.DATABASE_URL).toBe(
      "postgresql://user:pass@127.0.0.1:5432/testdb",
    );
  });

  it("does not overwrite already-set environment variable", () => {
    const secretPath = path.join(tempDir, "key.txt");
    fs.writeFileSync(secretPath, "from-file-value", "utf8");

    process.env.GITHUB_WEBHOOK_SECRET = "from-env-value";
    process.env.GITHUB_WEBHOOK_SECRET_FILE = secretPath;

    loadFileSecrets();

    expect(process.env.GITHUB_WEBHOOK_SECRET).toBe("from-env-value");
  });

  it("handles non-existent secret file gracefully without throwing", () => {
    delete process.env.SESSION_SECRET;
    process.env.SESSION_SECRET_FILE = path.join(tempDir, "non-existent.txt");

    expect(() => loadFileSecrets()).not.toThrow();
    expect(process.env.SESSION_SECRET).toBeUndefined();
  });
});
