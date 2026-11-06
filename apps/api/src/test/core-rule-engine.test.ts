import { describe, expect, it } from "vitest";
import {
  executeRuleEngine,
  getRegisteredRule,
  isRegisteredRuleType,
  MAX_CONFIGURED_RULES,
  RuleEngineResourceLimitError,
  RuleExecutionError,
  SUPPORTED_RULE_TYPES,
  UnknownRuleTypeError,
  type DeterministicRule,
  type ForbidRegexConfig,
  type RuleConfigItem,
  type RuleContext,
} from "@reviewlens/core";

describe("Rule Engine Architecture (M3 Step 1)", () => {
  const dummyContext: RuleContext = {
    repository: { owner: "org", name: "repo" },
    pullRequest: {
      number: 1,
      headSha: "1111111111111111111111111111111111111111",
      baseSha: "2222222222222222222222222222222222222222",
    },
    files: [
      {
        path: "src/index.ts",
        status: "modified",
        isEligible: true,
        parseStatus: "parsed",
        additions: [
          {
            line: 10,
            content: "console.log('hi');",
            hunkIndex: 0,
            commitSha: "1111111111111111111111111111111111111111",
          },
        ],
        metrics: { additions: 1, deletions: 0, changes: 1 },
      },
    ],
    metrics: {
      changedFiles: 1,
      additions: 1,
      deletions: 0,
      totalChanges: 1,
      completenessVerified: true,
    },
  };

  it("registry contains only the three approved rule types", () => {
    expect(SUPPORTED_RULE_TYPES).toEqual([
      "forbid_regex",
      "require_companion",
      "max_pr_size",
    ]);

    expect(isRegisteredRuleType("forbid_regex")).toBe(true);
    expect(isRegisteredRuleType("require_companion")).toBe(true);
    expect(isRegisteredRuleType("max_pr_size")).toBe(true);
    expect(isRegisteredRuleType("arbitrary_eval")).toBe(false);
  });

  it("rejects unknown rule type with UnknownRuleTypeError", () => {
    const invalidConfig = [
      {
        id: "bad-rule",
        type: "unregistered_type" as unknown as "forbid_regex",
        enabled: true,
      } as unknown as RuleConfigItem,
    ];

    expect(() => executeRuleEngine(dummyContext, invalidConfig)).toThrow(
      UnknownRuleTypeError,
    );
  });

  it("skips disabled rules while validating active rules", () => {
    const configs: RuleConfigItem[] = [
      {
        id: "disabled-rule",
        type: "forbid_regex",
        enabled: false,
        pattern: "console\\.log",
        message: "No console.log",
      },
    ];

    const result = executeRuleEngine(dummyContext, configs);
    expect(result.candidateFindings).toHaveLength(0);
    expect(result.executionResults).toHaveLength(0);
    expect(result.overallCoverage).toBe("no_rules");
  });

  it("executes rules serially in exact configuration order", () => {
    const configs: RuleConfigItem[] = [
      {
        id: "rule-1",
        type: "forbid_regex",
        enabled: true,
        pattern: "console\\.log",
        message: "No logging",
      },
      {
        id: "rule-2",
        type: "max_pr_size",
        enabled: true,
        max_files: 50,
      },
    ];

    const result = executeRuleEngine(dummyContext, configs);
    expect(result.executionResults).toHaveLength(2);
    expect(result.executionResults[0]?.ruleId).toBe("rule-1");
    expect(result.executionResults[1]?.ruleId).toBe("rule-2");
    expect(result.overallCoverage).toBe("complete");
  });

  it("yields identical output for identical input (pure determinism)", () => {
    const configs: RuleConfigItem[] = [
      {
        id: "rule-1",
        type: "forbid_regex",
        enabled: true,
        pattern: "console\\.log",
        message: "No logging",
      },
    ];

    const res1 = executeRuleEngine(dummyContext, configs);
    const res2 = executeRuleEngine(dummyContext, configs);

    expect(res1.candidateFindings).toEqual(res2.candidateFindings);
    expect(res1.executionResults).toEqual(res2.executionResults);
  });

  it("fails closed on unexpected rule exceptions with RuleExecutionError", () => {
    // Mock rule with unexpected runtime exception
    const buggyRule: DeterministicRule<ForbidRegexConfig> = {
      type: "forbid_regex",
      version: 1,
      evaluate: () => {
        throw new Error("Unexpected null pointer");
      },
    };

    const configs: RuleConfigItem[] = [
      {
        id: "buggy",
        type: "forbid_regex",
        enabled: true,
        pattern: "foo",
        message: "bar",
      },
    ];

    expect(() =>
      executeRuleEngine(dummyContext, configs, {
        getRule: (type) =>
          type === "forbid_regex" ? buggyRule : getRegisteredRule(type),
      }),
    ).toThrow(RuleExecutionError);
  });

  it("enforces MAX_CONFIGURED_RULES resource limit", () => {
    const configs: RuleConfigItem[] = Array.from(
      { length: MAX_CONFIGURED_RULES + 1 },
      (_, i) => ({
        id: `rule-${i}`,
        type: "forbid_regex",
        enabled: true,
        pattern: "foo",
        message: "bar",
      }),
    );

    expect(() => executeRuleEngine(dummyContext, configs)).toThrow(
      RuleEngineResourceLimitError,
    );
  });

  it("reports partial coverage when eligible files have unparsed patches", () => {
    const partialContext: RuleContext = {
      ...dummyContext,
      files: [
        {
          path: "src/eligible-unparsed.ts",
          status: "modified",
          isEligible: true,
          parseStatus: "malformed", // Eligible file could not be parsed
          additions: [],
          metrics: { additions: 0, deletions: 0, changes: 0 },
        },
      ],
    };

    const configs: RuleConfigItem[] = [
      {
        id: "check-log",
        type: "forbid_regex",
        enabled: true,
        pattern: "console\\.log",
        message: "No console",
      },
    ];

    const result = executeRuleEngine(partialContext, configs);
    expect(result.overallCoverage).toBe("partial");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.executionResults[0]?.status).toBe("partial");
  });
});
