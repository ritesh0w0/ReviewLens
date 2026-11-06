import { describe, expect, it } from "vitest";
import {
  loadRepositoryConfig,
  MAX_CONFIG_FILE_BYTES,
  MAX_PATTERNS_COUNT,
  MAX_PATTERN_LENGTH,
} from "../pipeline/config-loader.js";
import { PathFilter } from "../pipeline/path-filter.js";
import { FakeGitHubPullRequestClient } from "../github/fake-client.js";

describe("Repository Configuration and Path Filtering (Step 4)", () => {
  const baseSha = "1111111111111111111111111111111111111111";

  function createClient(contents: Record<string, string> = {}) {
    return new FakeGitHubPullRequestClient({
      prInfo: {
        state: "open",
        headSha: "2222222222222222222222222222222222222222",
        baseSha,
        prNumber: 42,
      },
      reviews: [],
      contents,
    });
  }

  describe("Configuration Loader", () => {
    it("returns status: missing and default configuration when .reviewlens.yml returns 404", async () => {
      const client = createClient(); // No contents configured -> 404
      const result = await loadRepositoryConfig(client, "org", "repo", baseSha);

      expect(result.status).toBe("missing");
      expect(result.source).toBe("base_commit");
      expect(result.baseSha).toBe(baseSha);
      expect(result.config.version).toBe(1);
      expect(result.config.paths?.include).toBeUndefined();
      expect(result.config.paths?.exclude).toEqual([]);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("loads and validates a valid .reviewlens.yml from base commit", async () => {
      const validYaml = [
        "version: 1",
        "paths:",
        "  include:",
        "    - 'src/**'",
        "  exclude:",
        "    - '**/*.generated.ts'",
        "    - 'dist/**'",
      ].join("\n");

      const client = createClient({
        [`.reviewlens.yml@${baseSha}`]: validYaml,
      });

      const result = await loadRepositoryConfig(client, "org", "repo", baseSha);

      expect(result.status).toBe("loaded");
      expect(result.baseSha).toBe(baseSha);
      expect(result.config.version).toBe(1);
      expect(result.config.paths?.include).toEqual(["src/**"]);
      expect(result.config.paths?.exclude).toEqual([
        "**/*.generated.ts",
        "dist/**",
      ]);
      expect(result.warnings).toHaveLength(0);

      // Verify Contents API was queried using exact baseSha
      expect(client.contentsCalls).toHaveLength(1);
      expect(client.contentsCalls[0]).toEqual({
        path: ".reviewlens.yml",
        ref: baseSha,
      });
    });

    it("defaults configuration when YAML syntax is invalid", async () => {
      const badYaml = "version: 1\n  invalid: [unbalanced";
      const client = createClient({ [`.reviewlens.yml@${baseSha}`]: badYaml });

      const result = await loadRepositoryConfig(client, "org", "repo", baseSha);
      expect(result.status).toBe("invalid_defaulted");
      expect(result.config.version).toBe(1);
      expect(result.warnings[0]).toContain(
        "Failed to parse .reviewlens.yml YAML",
      );
    });

    it("rejects duplicate YAML keys", async () => {
      const duplicateKeysYaml =
        "version: 1\npaths:\n  exclude: ['a']\npaths:\n  exclude: ['b']";
      const client = createClient({
        [`.reviewlens.yml@${baseSha}`]: duplicateKeysYaml,
      });

      const result = await loadRepositoryConfig(client, "org", "repo", baseSha);
      expect(result.status).toBe("invalid_defaulted");
      expect(result.warnings[0]).toContain(
        "Failed to parse .reviewlens.yml YAML",
      );
    });

    it("rejects unknown configuration keys and defaults", async () => {
      const unknownKeysYaml =
        "version: 1\nextra_unknown_field: true\npaths:\n  exclude: ['dist/**']";
      const client = createClient({
        [`.reviewlens.yml@${baseSha}`]: unknownKeysYaml,
      });

      const result = await loadRepositoryConfig(client, "org", "repo", baseSha);
      expect(result.status).toBe("invalid_defaulted");
      expect(result.warnings[0]).toContain("extra_unknown_field");
    });

    it("rejects unsupported schema version and defaults", async () => {
      const badVersionYaml = "version: 2\npaths:\n  exclude: ['dist/**']";
      const client = createClient({
        [`.reviewlens.yml@${baseSha}`]: badVersionYaml,
      });

      const result = await loadRepositoryConfig(client, "org", "repo", baseSha);
      expect(result.status).toBe("invalid_defaulted");
      expect(result.warnings[0]).toContain("version");
    });

    it("rejects file exceeding 32 KiB and defaults", async () => {
      const hugeYaml =
        "# " + "x".repeat(MAX_CONFIG_FILE_BYTES + 50) + "\nversion: 1\n";
      const client = createClient({
        [`.reviewlens.yml@${baseSha}`]: hugeYaml,
      });

      const result = await loadRepositoryConfig(client, "org", "repo", baseSha);
      expect(result.status).toBe("invalid_defaulted");
      expect(result.warnings[0]).toContain("exceeds maximum size");
    });

    it("rejects empty include list when include is specified", async () => {
      const emptyIncludeYaml = "version: 1\npaths:\n  include: []";
      const client = createClient({
        [`.reviewlens.yml@${baseSha}`]: emptyIncludeYaml,
      });

      const result = await loadRepositoryConfig(client, "org", "repo", baseSha);
      expect(result.status).toBe("invalid_defaulted");
      expect(result.warnings[0]).toContain(
        "Include list must contain at least 1 pattern",
      );
    });

    it("rejects patterns containing path traversal (..), absolute paths (/), or negations (!)", async () => {
      const traversalYaml = "version: 1\npaths:\n  exclude: ['../secret/**']";
      const client1 = createClient({
        [`.reviewlens.yml@${baseSha}`]: traversalYaml,
      });
      const res1 = await loadRepositoryConfig(client1, "org", "repo", baseSha);
      expect(res1.status).toBe("invalid_defaulted");
      expect(res1.warnings[0]).toContain("traversal");

      const absYaml = "version: 1\npaths:\n  exclude: ['/root/**']";
      const client2 = createClient({ [`.reviewlens.yml@${baseSha}`]: absYaml });
      const res2 = await loadRepositoryConfig(client2, "org", "repo", baseSha);
      expect(res2.status).toBe("invalid_defaulted");
      expect(res2.warnings[0]).toContain("Absolute");

      const negYaml = "version: 1\npaths:\n  exclude: ['!src/**']";
      const client3 = createClient({ [`.reviewlens.yml@${baseSha}`]: negYaml });
      const res3 = await loadRepositoryConfig(client3, "org", "repo", baseSha);
      expect(res3.status).toBe("invalid_defaulted");
      expect(res3.warnings[0]).toContain("Negated");
    });

    it("rejects patterns exceeding 256 characters", async () => {
      const longPattern = "src/" + "a".repeat(MAX_PATTERN_LENGTH + 5);
      const longYaml = `version: 1\npaths:\n  include: ['${longPattern}']`;
      const client = createClient({ [`.reviewlens.yml@${baseSha}`]: longYaml });

      const res = await loadRepositoryConfig(client, "org", "repo", baseSha);
      expect(res.status).toBe("invalid_defaulted");
      expect(res.warnings[0]).toContain("exceeds 256 characters");
    });

    it("rejects more than 100 patterns in include or exclude list", async () => {
      const patterns = Array.from(
        { length: MAX_PATTERNS_COUNT + 1 },
        (_, i) => `src/item${i}/**`,
      );
      const yamlContent =
        `version: 1\npaths:\n  exclude:\n` +
        patterns.map((p) => `    - '${p}'`).join("\n");
      const client = createClient({
        [`.reviewlens.yml@${baseSha}`]: yamlContent,
      });

      const res = await loadRepositoryConfig(client, "org", "repo", baseSha);
      expect(res.status).toBe("invalid_defaulted");
      expect(res.warnings[0]).toContain("exceeds 100 patterns");
    });

    it("propagates GitHub 403 permission failures as real errors", async () => {
      const permError = new Error("Resource not accessible by integration");
      (permError as unknown as { status: number }).status = 403;

      const client = new FakeGitHubPullRequestClient({
        prInfo: { state: "open", headSha: "h", baseSha, prNumber: 1 },
        reviews: [],
        shouldFailContentWith: permError,
      });

      await expect(
        loadRepositoryConfig(client, "org", "repo", baseSha),
      ).rejects.toThrow("Resource not accessible by integration");
    });
  });

  describe("PathFilter Semantics", () => {
    it("includes all files by default when include is omitted", () => {
      const filter = new PathFilter({ version: 1 });
      const dec1 = filter.evaluate({ path: "src/index.ts" });
      const dec2 = filter.evaluate({ path: "docs/readme.md" });

      expect(dec1.included).toBe(true);
      expect(dec1.reason).toBe("default_include");
      expect(dec2.included).toBe(true);
      expect(dec2.reason).toBe("default_include");
    });

    it("enforces include list when present", () => {
      const filter = new PathFilter({
        version: 1,
        paths: {
          include: ["src/**", "packages/*/src/**"],
          exclude: [],
        },
      });

      const dec1 = filter.evaluate({ path: "src/app.ts" });
      expect(dec1.included).toBe(true);
      expect(dec1.reason).toBe("matched_include");
      expect(dec1.matchedPattern).toBe("src/**");

      const dec2 = filter.evaluate({ path: "packages/core/src/index.ts" });
      expect(dec2.included).toBe(true);
      expect(dec2.reason).toBe("matched_include");

      const dec3 = filter.evaluate({ path: "scripts/build.sh" });
      expect(dec3.included).toBe(false);
      expect(dec3.reason).toBe("no_include_match");
    });

    it("enforces exclusion precedence (exclude wins even if matching include)", () => {
      const filter = new PathFilter({
        version: 1,
        paths: {
          include: ["src/**"],
          exclude: ["src/**/*.generated.ts", "src/vendor/**"],
        },
      });

      const decNormal = filter.evaluate({ path: "src/utils.ts" });
      expect(decNormal.included).toBe(true);
      expect(decNormal.reason).toBe("matched_include");

      const decGen = filter.evaluate({ path: "src/types/schema.generated.ts" });
      expect(decGen.included).toBe(false);
      expect(decGen.reason).toBe("matched_exclude");
      expect(decGen.matchedPattern).toBe("src/**/*.generated.ts");

      const decVendor = filter.evaluate({ path: "src/vendor/lib.js" });
      expect(decVendor.included).toBe(false);
      expect(decVendor.reason).toBe("matched_exclude");
    });

    it("prevents rename exclusion bypass: excludes file if old path matched an exclude pattern", () => {
      const filter = new PathFilter({
        version: 1,
        paths: {
          include: ["src/**"],
          exclude: ["secrets/**"],
        },
      });

      // Developer renamed `secrets/credentials.ts` to `src/config.ts`
      const dec = filter.evaluate({
        path: "src/config.ts",
        previousPath: "secrets/credentials.ts",
        status: "renamed",
      });

      // Must be excluded because old path matched `secrets/**`
      expect(dec.included).toBe(false);
      expect(dec.reason).toBe("matched_exclude");
      expect(dec.matchedPattern).toBe("secrets/**");
    });

    it("excludes file if new path matched an exclude pattern on rename", () => {
      const filter = new PathFilter({
        version: 1,
        paths: {
          include: ["**/*"],
          exclude: ["dist/**"],
        },
      });

      const dec = filter.evaluate({
        path: "dist/bundle.js",
        previousPath: "src/bundle.js",
        status: "renamed",
      });

      expect(dec.included).toBe(false);
      expect(dec.reason).toBe("matched_exclude");
    });

    it("handles dotfiles consistently without silent bypass", () => {
      const filter = new PathFilter({
        version: 1,
        paths: {
          exclude: ["**/.env*", ".github/**"],
        },
      });

      const dec1 = filter.evaluate({ path: "src/.env.local" });
      expect(dec1.included).toBe(false);
      expect(dec1.reason).toBe("matched_exclude");

      const dec2 = filter.evaluate({ path: ".github/workflows/ci.yml" });
      expect(dec2.included).toBe(false);
      expect(dec2.reason).toBe("matched_exclude");
    });

    it("evaluates deleted files correctly", () => {
      const filter = new PathFilter({
        version: 1,
        paths: {
          include: ["src/**"],
          exclude: ["**/*.test.ts"],
        },
      });

      const decDelNormal = filter.evaluate({
        path: "src/old-module.ts",
        status: "removed",
      });
      expect(decDelNormal.included).toBe(true);

      const decDelTest = filter.evaluate({
        path: "src/old.test.ts",
        status: "removed",
      });
      expect(decDelTest.included).toBe(false);
      expect(decDelTest.reason).toBe("matched_exclude");
    });
  });
});
