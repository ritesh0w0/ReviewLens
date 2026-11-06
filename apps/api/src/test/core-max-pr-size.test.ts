import { describe, expect, it } from "vitest";
import {
  maxPrSizeRule,
  type MaxPrSizeConfig,
  type RuleContext,
} from "@reviewlens/core";

describe("Rule C — max_pr_size (M3 Step 2)", () => {
  const headSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const baseSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  function createContext(
    changedFiles: number,
    additions: number,
    deletions: number,
  ): RuleContext {
    return {
      repository: { owner: "org", name: "repo" },
      pullRequest: { number: 42, headSha, baseSha },
      files: Array.from({ length: changedFiles }, (_, i) => ({
        path: `file_${i}.ts`,
        status: "modified",
        isEligible: true,
        parseStatus: "parsed",
        additions: [],
        metrics: { additions: 1, deletions: 1, changes: 2 },
      })),
      metrics: {
        changedFiles,
        additions,
        deletions,
        totalChanges: additions + deletions,
        completenessVerified: true,
      },
    };
  }

  it("produces no finding when file count is below maximum", () => {
    const context = createContext(10, 100, 50); // 10 files, 150 changes
    const config: MaxPrSizeConfig = {
      id: "pr-size",
      type: "max_pr_size",
      enabled: true,
      max_files: 20,
    };

    const outcome = maxPrSizeRule.evaluate(context, config);
    expect(outcome.candidates).toHaveLength(0);
  });

  it("produces no finding when file count exactly equals maximum (strict >)", () => {
    const context = createContext(20, 100, 50); // exactly 20 files
    const config: MaxPrSizeConfig = {
      id: "pr-size",
      type: "max_pr_size",
      enabled: true,
      max_files: 20,
    };

    const outcome = maxPrSizeRule.evaluate(context, config);
    expect(outcome.candidates).toHaveLength(0);
  });

  it("produces finding when file count exceeds maximum", () => {
    const context = createContext(21, 100, 50); // 21 files > 20 limit
    const config: MaxPrSizeConfig = {
      id: "pr-size",
      type: "max_pr_size",
      enabled: true,
      max_files: 20,
    };

    const outcome = maxPrSizeRule.evaluate(context, config);
    expect(outcome.candidates).toHaveLength(1);

    const f = outcome.candidates[0]!;
    expect(f.code).toBe("PR_SIZE_EXCEEDED");
    expect(f.scope).toBe("pull_request");
    expect(f.severity).toBe("low");
    expect(f.primaryEvidence).toEqual({
      kind: "pull_request_metric",
      metric: "changed_files",
      actual: 21,
      threshold: 20,
      comparator: "greater_than",
    });
  });

  it("produces no finding when total changes exactly equals maximum (strict >)", () => {
    const context = createContext(5, 300, 200); // exactly 500 changes
    const config: MaxPrSizeConfig = {
      id: "pr-size",
      type: "max_pr_size",
      enabled: true,
      max_total_changes: 500,
    };

    const outcome = maxPrSizeRule.evaluate(context, config);
    expect(outcome.candidates).toHaveLength(0);
  });

  it("produces finding when total changes exceeds maximum", () => {
    const context = createContext(5, 301, 200); // 501 changes > 500 limit
    const config: MaxPrSizeConfig = {
      id: "pr-size",
      type: "max_pr_size",
      enabled: true,
      max_total_changes: 500,
    };

    const outcome = maxPrSizeRule.evaluate(context, config);
    expect(outcome.candidates).toHaveLength(1);

    const f = outcome.candidates[0]!;
    expect(f.code).toBe("PR_SIZE_EXCEEDED");
    expect(f.primaryEvidence).toEqual({
      kind: "pull_request_metric",
      metric: "total_changes",
      actual: 501,
      threshold: 500,
      comparator: "greater_than",
    });
  });

  it("produces ONE consolidated finding when both files and total changes are exceeded", () => {
    const context = createContext(35, 600, 400); // 35 files (> 30), 1000 changes (> 800)
    const config: MaxPrSizeConfig = {
      id: "pr-size",
      type: "max_pr_size",
      enabled: true,
      max_files: 30,
      max_total_changes: 800,
    };

    const outcome = maxPrSizeRule.evaluate(context, config);
    // Must generate ONE consolidated finding, not multiple noisy findings!
    expect(outcome.candidates).toHaveLength(1);

    const f = outcome.candidates[0]!;
    expect(f.primaryEvidence).toEqual({
      kind: "pull_request_metric",
      metric: "changed_files",
      actual: 35,
      threshold: 30,
      comparator: "greater_than",
    });

    expect(f.supportingEvidence).toHaveLength(1);
    expect(f.supportingEvidence![0]).toEqual({
      kind: "pull_request_metric",
      metric: "total_changes",
      actual: 1000,
      threshold: 800,
      comparator: "greater_than",
    });

    expect(f.message).toContain("35 changed files (limit: 30)");
    expect(f.message).toContain("1000 total changes (limit: 800)");
  });

  it("does not trigger violation for zero-file pull request", () => {
    const context = createContext(0, 0, 0); // 0 files, 0 changes
    const config: MaxPrSizeConfig = {
      id: "pr-size",
      type: "max_pr_size",
      enabled: true,
      max_files: 10,
      max_total_changes: 100,
    };

    const outcome = maxPrSizeRule.evaluate(context, config);
    expect(outcome.candidates).toHaveLength(0);
  });

  it("supports severity override in configuration", () => {
    const context = createContext(50, 100, 100);
    const config: MaxPrSizeConfig = {
      id: "pr-size",
      type: "max_pr_size",
      enabled: true,
      max_files: 10,
      severity: "medium",
    };

    const outcome = maxPrSizeRule.evaluate(context, config);
    expect(outcome.candidates[0]?.severity).toBe("medium");
  });
});
