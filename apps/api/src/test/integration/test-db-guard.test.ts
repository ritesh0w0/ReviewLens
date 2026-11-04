import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateAndApplyTestDbEnvironment } from "./test-db-guard.js";

describe("Test Database Safety Guard", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.DATABASE_URL_TEST;
    delete process.env.DIRECT_DATABASE_URL_TEST;
    delete process.env.DATABASE_URL;
    delete process.env.DIRECT_DATABASE_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("fails if DATABASE_URL_TEST is missing", () => {
    expect(() => validateAndApplyTestDbEnvironment()).toThrow(
      "DATABASE_URL_TEST is not configured",
    );
  });

  it("fails if DATABASE_URL_TEST uses invalid protocol", () => {
    process.env.DATABASE_URL_TEST =
      "mysql://user:pass@127.0.0.1:55432/reviewlens_test";
    expect(() => validateAndApplyTestDbEnvironment()).toThrow(
      "must use postgresql: protocol",
    );
  });

  it("fails if host is remote or unapproved", () => {
    process.env.DATABASE_URL_TEST =
      "postgresql://user:pass@production-db.azure.com:5432/reviewlens_test";
    expect(() => validateAndApplyTestDbEnvironment()).toThrow(
      "is not in the approved test hosts list",
    );
  });

  it("fails if port is unapproved", () => {
    process.env.DATABASE_URL_TEST =
      "postgresql://user:pass@127.0.0.1:3306/reviewlens_test";
    expect(() => validateAndApplyTestDbEnvironment()).toThrow(
      "is not in the approved test ports list",
    );
  });

  it("fails if database target is not reviewlens_test (e.g. reviewlens_dev or production)", () => {
    process.env.DATABASE_URL_TEST =
      "postgresql://user:pass@127.0.0.1:55432/reviewlens_dev";
    expect(() => validateAndApplyTestDbEnvironment()).toThrow(
      "Database target must be exactly 'reviewlens_test'",
    );
  });

  it("succeeds and sets runtime environment for valid 127.0.0.1:55432/reviewlens_test", () => {
    const validUrl =
      "postgresql://reviewlens:secret@127.0.0.1:55432/reviewlens_test";
    process.env.DATABASE_URL_TEST = validUrl;

    const config = validateAndApplyTestDbEnvironment();
    expect(config.database).toBe("reviewlens_test");
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(55432);
    expect(process.env.DATABASE_URL).toBe(validUrl);
    expect(process.env.DIRECT_DATABASE_URL).toBe(validUrl);
  });

  it("succeeds for CI postgres host on port 5432", () => {
    const ciUrl =
      "postgresql://postgres:postgres@postgres:5432/reviewlens_test";
    process.env.DATABASE_URL_TEST = ciUrl;

    const config = validateAndApplyTestDbEnvironment();
    expect(config.database).toBe("reviewlens_test");
    expect(config.host).toBe("postgres");
    expect(config.port).toBe(5432);
  });
});
