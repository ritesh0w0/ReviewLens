import { describe, expect, it } from "vitest";
import { loadRepositoryConfig } from "../pipeline/config-loader.js";
import { FakeGitHubPullRequestClient } from "../github/fake-client.js";

describe("Rule and Review Configuration Loading (M3 Step 2 & 4)", () => {
  const baseSha = "1111111111111111111111111111111111111111";

  function createClient(yamlContent: string) {
    return new FakeGitHubPullRequestClient({
      prInfo: {
        state: "open",
        headSha: "2222222222222222222222222222222222222222",
        baseSha,
        prNumber: 42,
      },
      reviews: [],
      contents: {
        [`.reviewlens.yml@${baseSha}`]: yamlContent,
      },
    });
  }

  it("loads valid configuration with rules and review settings", async () => {
    const yaml = [
      "version: 1",
      "paths:",
      "  include: ['src/**']",
      "review:",
      "  max_inline_comments: 5",
      "rules:",
      "  - id: no-console",
      "    type: forbid_regex",
      "    enabled: true",
      "    pattern: 'console\\.log\\('",
      "    message: 'No console logs'",
      "    severity: low",
      "  - id: service-test-pair",
      "    type: require_companion",
      "    enabled: true",
      "    source_suffix: '.service.ts'",
      "    companion_suffix: '.service.test.ts'",
      "  - id: pr-size",
      "    type: max_pr_size",
      "    enabled: true",
      "    max_files: 30",
      "    max_total_changes: 800",
    ].join("\n");

    const client = createClient(yaml);
    const result = await loadRepositoryConfig(client, "org", "repo", baseSha);

    expect(result.status).toBe("loaded");
    expect(result.config.review?.max_inline_comments).toBe(5);
    expect(result.config.rules).toHaveLength(3);
    expect(result.config.rules![0]?.id).toBe("no-console");
    expect(result.config.rules![1]?.id).toBe("service-test-pair");
    expect(result.config.rules![2]?.id).toBe("pr-size");
  });

  it("defaults review.max_inline_comments to 8 when review section is omitted", async () => {
    const yaml = "version: 1\n";
    const client = createClient(yaml);
    const result = await loadRepositoryConfig(client, "org", "repo", baseSha);

    expect(result.status).toBe("loaded");
    expect(result.config.review?.max_inline_comments).toBe(8);
    expect(result.config.rules).toEqual([]);
  });

  it("rejects review.max_inline_comments exceeding 8 and defaults", async () => {
    const yaml = "version: 1\nreview:\n  max_inline_comments: 9\n";
    const client = createClient(yaml);
    const result = await loadRepositoryConfig(client, "org", "repo", baseSha);

    expect(result.status).toBe("invalid_defaulted");
    expect(result.warnings[0]).toContain("max_inline_comments cannot exceed 8");
  });

  it("rejects negative review.max_inline_comments and defaults", async () => {
    const yaml = "version: 1\nreview:\n  max_inline_comments: -1\n";
    const client = createClient(yaml);
    const result = await loadRepositoryConfig(client, "org", "repo", baseSha);

    expect(result.status).toBe("invalid_defaulted");
    expect(result.warnings[0]).toContain("cannot be negative");
  });

  it("allows review.max_inline_comments: 0", async () => {
    const yaml = "version: 1\nreview:\n  max_inline_comments: 0\n";
    const client = createClient(yaml);
    const result = await loadRepositoryConfig(client, "org", "repo", baseSha);

    expect(result.status).toBe("loaded");
    expect(result.config.review?.max_inline_comments).toBe(0);
  });

  it("rejects duplicate rule IDs and defaults", async () => {
    const yaml = [
      "version: 1",
      "rules:",
      "  - id: duplicate-id",
      "    type: forbid_regex",
      "    enabled: true",
      "    pattern: 'a'",
      "    message: 'msg'",
      "  - id: duplicate-id",
      "    type: forbid_regex",
      "    enabled: true",
      "    pattern: 'b'",
      "    message: 'msg'",
    ].join("\n");

    const client = createClient(yaml);
    const result = await loadRepositoryConfig(client, "org", "repo", baseSha);

    expect(result.status).toBe("invalid_defaulted");
    expect(result.warnings[0]).toContain("Rule IDs must be unique");
  });

  it("rejects more than one max_pr_size rule entry and defaults", async () => {
    const yaml = [
      "version: 1",
      "rules:",
      "  - id: size-1",
      "    type: max_pr_size",
      "    enabled: true",
      "    max_files: 10",
      "  - id: size-2",
      "    type: max_pr_size",
      "    enabled: true",
      "    max_files: 20",
    ].join("\n");

    const client = createClient(yaml);
    const result = await loadRepositoryConfig(client, "org", "repo", baseSha);

    expect(result.status).toBe("invalid_defaulted");
    expect(result.warnings[0]).toContain(
      "At most one max_pr_size rule is allowed",
    );
  });

  it("rejects invalid regex syntax during config validation and defaults", async () => {
    const yaml = [
      "version: 1",
      "rules:",
      "  - id: bad-regex",
      "    type: forbid_regex",
      "    enabled: true",
      "    pattern: '[unclosed-bracket'",
      "    message: 'msg'",
    ].join("\n");

    const client = createClient(yaml);
    const result = await loadRepositoryConfig(client, "org", "repo", baseSha);

    expect(result.status).toBe("invalid_defaulted");
    expect(result.warnings[0]).toContain(
      "Pattern must be a valid RE2 regular expression",
    );
  });

  it("rejects unknown rule types and defaults", async () => {
    const yaml = [
      "version: 1",
      "rules:",
      "  - id: unknown",
      "    type: arbitrary_type",
      "    enabled: true",
    ].join("\n");

    const client = createClient(yaml);
    const result = await loadRepositoryConfig(client, "org", "repo", baseSha);

    expect(result.status).toBe("invalid_defaulted");
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
