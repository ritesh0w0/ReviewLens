import { describe, expect, it } from "vitest";
import {
  forbidRegexRule,
  type ForbidRegexConfig,
  type RuleContext,
} from "@reviewlens/core";
import { createHash } from "node:crypto";

describe("Rule A — forbid_regex (M3 Step 2)", () => {
  const headSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const baseSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  function createContext(files: RuleContext["files"]): RuleContext {
    return {
      repository: { owner: "org", name: "repo" },
      pullRequest: { number: 42, headSha, baseSha },
      files,
      metrics: {
        changedFiles: files.length,
        additions: 10,
        deletions: 0,
        totalChanges: 10,
        completenessVerified: true,
      },
    };
  }

  it("produces finding for matching addition line", () => {
    const content = "console.log('debug message');";
    const context = createContext([
      {
        path: "src/app.ts",
        status: "modified",
        isEligible: true,
        parseStatus: "parsed",
        additions: [{ line: 15, content, hunkIndex: 0, commitSha: headSha }],
        metrics: { additions: 1, deletions: 0, changes: 1 },
      },
    ]);

    const config: ForbidRegexConfig = {
      id: "no-console",
      type: "forbid_regex",
      enabled: true,
      pattern: "console\\.log\\s*\\(",
      message: "Avoid console.log in production code",
    };

    const outcome = forbidRegexRule.evaluate(context, config);
    expect(outcome.candidates).toHaveLength(1);

    const finding = outcome.candidates[0]!;
    expect(finding.code).toBe("FORBIDDEN_PATTERN");
    expect(finding.scope).toBe("line");
    expect(finding.message).toBe("Avoid console.log in production code");
    expect(finding.severity).toBe("medium"); // Default severity

    const ev = finding.primaryEvidence as {
      path: string;
      side: string;
      line: number;
      commitSha: string;
      lineHash: string;
      matchRange?: { start: number; end: number };
    };
    expect(ev.path).toBe("src/app.ts");
    expect(ev.side).toBe("RIGHT");
    expect(ev.line).toBe(15);
    expect(ev.commitSha).toBe(headSha);
    expect(ev.lineHash).toBe(
      createHash("sha256").update(content, "utf8").digest("hex"),
    );
    expect(ev.matchRange).toEqual({ start: 0, end: 12 });
  });

  it("produces no findings when pattern does not match", () => {
    const context = createContext([
      {
        path: "src/clean.ts",
        status: "modified",
        isEligible: true,
        parseStatus: "parsed",
        additions: [
          {
            line: 5,
            content: "logger.info('safe');",
            hunkIndex: 0,
            commitSha: headSha,
          },
        ],
        metrics: { additions: 1, deletions: 0, changes: 1 },
      },
    ]);

    const config: ForbidRegexConfig = {
      id: "no-console",
      type: "forbid_regex",
      enabled: true,
      pattern: "console\\.log",
      message: "No console",
    };

    const outcome = forbidRegexRule.evaluate(context, config);
    expect(outcome.candidates).toHaveLength(0);
    expect(outcome.status).toBe("completed");
  });

  it("produces at most one finding per line even if pattern matches multiple times on that line", () => {
    const lineWithMultipleMatches = "console.log(1); console.log(2);";
    const context = createContext([
      {
        path: "src/multi.ts",
        status: "modified",
        isEligible: true,
        parseStatus: "parsed",
        additions: [
          {
            line: 20,
            content: lineWithMultipleMatches,
            hunkIndex: 0,
            commitSha: headSha,
          },
        ],
        metrics: { additions: 1, deletions: 0, changes: 1 },
      },
    ]);

    const config: ForbidRegexConfig = {
      id: "no-console",
      type: "forbid_regex",
      enabled: true,
      pattern: "console\\.log",
      message: "No console",
    };

    const outcome = forbidRegexRule.evaluate(context, config);
    expect(outcome.candidates).toHaveLength(1);
    expect(outcome.candidates[0]?.primaryEvidence.kind).toBe("code_line");
  });

  it("ignores excluded files completely without generating findings or partial coverage", () => {
    const context = createContext([
      {
        path: "dist/bundle.js",
        status: "added",
        isEligible: false, // Excluded by path filter
        parseStatus: "excluded",
        additions: [
          {
            line: 1,
            content: "console.log('in dist');",
            hunkIndex: 0,
            commitSha: headSha,
          },
        ],
        metrics: { additions: 1, deletions: 0, changes: 1 },
      },
    ]);

    const config: ForbidRegexConfig = {
      id: "no-console",
      type: "forbid_regex",
      enabled: true,
      pattern: "console\\.log",
      message: "No console",
    };

    const outcome = forbidRegexRule.evaluate(context, config);
    expect(outcome.candidates).toHaveLength(0);
    expect(outcome.status).toBe("completed");
  });

  it("marks partial coverage when an eligible file has unparsed/unavailable patch", () => {
    const context = createContext([
      {
        path: "src/binary.dat",
        status: "modified",
        isEligible: true,
        parseStatus: "patch_unavailable",
        additions: [],
        metrics: { additions: 0, deletions: 0, changes: 0 },
      },
    ]);

    const config: ForbidRegexConfig = {
      id: "no-console",
      type: "forbid_regex",
      enabled: true,
      pattern: "console\\.log",
      message: "No console",
    };

    const outcome = forbidRegexRule.evaluate(context, config);
    expect(outcome.status).toBe("partial");
    expect(outcome.unmetRequirements).toHaveLength(1);
    expect(outcome.unmetRequirements![0]).toContain("patch_unavailable");
  });

  it("respects case_sensitive: false configuration", () => {
    const context = createContext([
      {
        path: "src/case.ts",
        status: "modified",
        isEligible: true,
        parseStatus: "parsed",
        additions: [
          {
            line: 1,
            content: "const token = SECRET_KEY;",
            hunkIndex: 0,
            commitSha: headSha,
          },
        ],
        metrics: { additions: 1, deletions: 0, changes: 1 },
      },
    ]);

    // Case-sensitive default: does not match
    const caseSensitiveConfig: ForbidRegexConfig = {
      id: "no-secret",
      type: "forbid_regex",
      enabled: true,
      pattern: "secret_key",
      message: "No secret key",
    };
    const res1 = forbidRegexRule.evaluate(context, caseSensitiveConfig);
    expect(res1.candidates).toHaveLength(0);

    // Case-insensitive: matches!
    const caseInsensitiveConfig: ForbidRegexConfig = {
      id: "no-secret",
      type: "forbid_regex",
      enabled: true,
      pattern: "secret_key",
      case_sensitive: false,
      message: "No secret key",
    };
    const res2 = forbidRegexRule.evaluate(context, caseInsensitiveConfig);
    expect(res2.candidates).toHaveLength(1);
  });

  it("supports severity override in configuration", () => {
    const context = createContext([
      {
        path: "src/app.ts",
        status: "modified",
        isEligible: true,
        parseStatus: "parsed",
        additions: [
          {
            line: 1,
            content: "eval('malicious');",
            hunkIndex: 0,
            commitSha: headSha,
          },
        ],
        metrics: { additions: 1, deletions: 0, changes: 1 },
      },
    ]);

    const config: ForbidRegexConfig = {
      id: "no-eval",
      type: "forbid_regex",
      enabled: true,
      pattern: "eval\\s*\\(",
      message: "Never use eval",
      severity: "critical",
    };

    const outcome = forbidRegexRule.evaluate(context, config);
    expect(outcome.candidates[0]?.severity).toBe("critical");
  });

  it("evaluates ReDoS-oriented adversarial patterns safely within bounded RE2 time", () => {
    const context = createContext([
      {
        path: "src/test.ts",
        status: "modified",
        isEligible: true,
        parseStatus: "parsed",
        additions: [
          {
            line: 1,
            content: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!",
            hunkIndex: 0,
            commitSha: headSha,
          },
        ],
        metrics: { additions: 1, deletions: 0, changes: 1 },
      },
    ]);

    // Classical backtracking catastrophic pattern: (a+)+$
    const config: ForbidRegexConfig = {
      id: "redos-test",
      type: "forbid_regex",
      enabled: true,
      pattern: "(a+)+b",
      message: "No match",
    };

    const start = Date.now();
    const outcome = forbidRegexRule.evaluate(context, config);
    const elapsedMs = Date.now() - start;

    expect(elapsedMs).toBeLessThan(100); // Must be near-instantaneous in RE2!
    expect(outcome.candidates).toHaveLength(0);
  });

  it("never echoes matched line text or secret values in candidate message", () => {
    const secretLine = "const apiKey = 'custom_secret_key_999999999999999999999999';";
    const context = createContext([
      {
        path: "src/keys.ts",
        status: "modified",
        isEligible: true,
        parseStatus: "parsed",
        additions: [
          {
            line: 1,
            content: secretLine,
            hunkIndex: 0,
            commitSha: headSha,
          },
        ],
        metrics: { additions: 1, deletions: 0, changes: 1 },
      },
    ]);

    const config: ForbidRegexConfig = {
      id: "no-secret",
      type: "forbid_regex",
      enabled: true,
      pattern: "custom_secret_key_[0-9a-zA-Z]+",
      message: "Do not commit production API keys.",
    };

    const outcome = forbidRegexRule.evaluate(context, config);
    expect(outcome.candidates).toHaveLength(1);

    const finding = outcome.candidates[0]!;
    expect(finding.message).toBe("Do not commit production API keys.");
    expect(finding.message).not.toContain("custom_secret_key_");
    expect(finding.title).not.toContain("custom_secret_key_");
  });
});
