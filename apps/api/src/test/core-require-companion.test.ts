import { describe, expect, it } from "vitest";
import {
  requireCompanionRule,
  type RequireCompanionConfig,
  type RuleContext,
} from "@reviewlens/core";

describe("Rule B — require_companion (M3 Step 2)", () => {
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

  const baseConfig: RequireCompanionConfig = {
    id: "service-test-pair",
    type: "require_companion",
    enabled: true,
    source_suffix: ".service.ts",
    companion_suffix: ".service.test.ts",
  };

  it("produces finding when added service file has no companion in PR", () => {
    const context = createContext([
      {
        path: "src/auth/login.service.ts",
        status: "added",
        isEligible: true,
        parseStatus: "parsed",
        additions: [],
        metrics: { additions: 10, deletions: 0, changes: 10 },
      },
    ]);

    const outcome = requireCompanionRule.evaluate(context, baseConfig);
    expect(outcome.candidates).toHaveLength(1);

    const f = outcome.candidates[0]!;
    expect(f.code).toBe("COMPANION_MISSING");
    expect(f.scope).toBe("file");
    expect(f.severity).toBe("low"); // Default severity
    expect(f.primaryEvidence).toEqual({
      kind: "file_relationship",
      relation: "companion_missing_from_pr",
      sourcePath: "src/auth/login.service.ts",
      expectedPath: "src/auth/login.service.test.ts",
      companionPresentInPr: false,
    });
  });

  it("produces no finding when companion is present as an active added/modified file", () => {
    const context = createContext([
      {
        path: "src/auth/login.service.ts",
        status: "modified",
        isEligible: true,
        parseStatus: "parsed",
        additions: [],
        metrics: { additions: 5, deletions: 0, changes: 5 },
      },
      {
        path: "src/auth/login.service.test.ts",
        status: "added",
        isEligible: true,
        parseStatus: "parsed",
        additions: [],
        metrics: { additions: 20, deletions: 0, changes: 20 },
      },
    ]);

    const outcome = requireCompanionRule.evaluate(context, baseConfig);
    expect(outcome.candidates).toHaveLength(0);
    expect(outcome.status).toBe("completed");
  });

  it("companion satisfies requirement even if companion file is path-excluded from diff scanning", () => {
    const context = createContext([
      {
        path: "src/auth/login.service.ts",
        status: "added",
        isEligible: true,
        parseStatus: "parsed",
        additions: [],
        metrics: { additions: 10, deletions: 0, changes: 10 },
      },
      {
        path: "src/auth/login.service.test.ts",
        status: "added",
        isEligible: false, // Companion is path-excluded!
        parseStatus: "excluded",
        additions: [],
        metrics: { additions: 10, deletions: 0, changes: 10 },
      },
    ]);

    const outcome = requireCompanionRule.evaluate(context, baseConfig);
    expect(outcome.candidates).toHaveLength(0);
  });

  it("deleted companion file does NOT satisfy requirement", () => {
    const context = createContext([
      {
        path: "src/auth/login.service.ts",
        status: "modified",
        isEligible: true,
        parseStatus: "parsed",
        additions: [],
        metrics: { additions: 5, deletions: 0, changes: 5 },
      },
      {
        path: "src/auth/login.service.test.ts",
        status: "removed", // Deleted!
        isEligible: true,
        parseStatus: "parsed",
        additions: [],
        metrics: { additions: 0, deletions: 10, changes: 10 },
      },
    ]);

    const outcome = requireCompanionRule.evaluate(context, baseConfig);
    expect(outcome.candidates).toHaveLength(1);
    expect(outcome.candidates[0]?.primaryEvidence.kind).toBe(
      "file_relationship",
    );
  });

  it("deleted source file does not trigger requirement", () => {
    const context = createContext([
      {
        path: "src/auth/old.service.ts",
        status: "removed", // Deleted source file
        isEligible: true,
        parseStatus: "parsed",
        additions: [],
        metrics: { additions: 0, deletions: 10, changes: 10 },
      },
    ]);

    const outcome = requireCompanionRule.evaluate(context, baseConfig);
    expect(outcome.candidates).toHaveLength(0);
  });

  it("renamed source file uses its new path to derive companion", () => {
    const context = createContext([
      {
        path: "src/new/user.service.ts",
        previousPath: "src/old/user.service.ts",
        status: "renamed",
        isEligible: true,
        parseStatus: "parsed",
        additions: [],
        metrics: { additions: 1, deletions: 1, changes: 2 },
      },
      {
        path: "src/new/user.service.test.ts", // Companion at new path
        status: "renamed",
        isEligible: true,
        parseStatus: "parsed",
        additions: [],
        metrics: { additions: 1, deletions: 1, changes: 2 },
      },
    ]);

    const outcome = requireCompanionRule.evaluate(context, baseConfig);
    expect(outcome.candidates).toHaveLength(0);
  });

  it("reports not_applicable when no files match the configured source suffix", () => {
    const context = createContext([
      {
        path: "src/utils.ts",
        status: "added",
        isEligible: true,
        parseStatus: "parsed",
        additions: [],
        metrics: { additions: 5, deletions: 0, changes: 5 },
      },
    ]);

    const outcome = requireCompanionRule.evaluate(context, baseConfig);
    expect(outcome.status).toBe("not_applicable");
    expect(outcome.candidates).toHaveLength(0);
  });

  it("supports severity override in configuration", () => {
    const context = createContext([
      {
        path: "src/auth.service.ts",
        status: "added",
        isEligible: true,
        parseStatus: "parsed",
        additions: [],
        metrics: { additions: 1, deletions: 0, changes: 1 },
      },
    ]);

    const configWithSeverity: RequireCompanionConfig = {
      ...baseConfig,
      severity: "high",
    };

    const outcome = requireCompanionRule.evaluate(context, configWithSeverity);
    expect(outcome.candidates[0]?.severity).toBe("high");
  });
});
