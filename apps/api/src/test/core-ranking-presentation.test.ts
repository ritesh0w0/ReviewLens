import { describe, expect, it } from "vitest";
import {
  groupSameAnchorFindings,
  planPresentation,
  rankFindings,
  type ValidatedFinding,
} from "@reviewlens/core";
import {
  buildReviewPayload,
  sanitizeMarkdown,
  MAX_SUMMARY_BYTES,
} from "../review/payload-builder.js";

describe("Ranking, Prioritization & Presentation (M3 Step 4)", () => {
  function makeFinding(
    id: string,
    overrides: Partial<ValidatedFinding> = {},
  ): ValidatedFinding {
    return {
      schemaVersion: 1,
      code: "RULE_CODE",
      title: `Finding ${id}`,
      message: `Message ${id}`,
      severity: "medium",
      scope: "line",
      primaryEvidence: {
        kind: "code_line",
        path: "src/a.ts",
        side: "RIGHT",
        line: 10,
        commitSha: "1111111111111111111111111111111111111111",
        lineHash: "hash",
        hunkIndex: 0,
      },
      origin: {
        kind: "deterministic_rule",
        ruleId: "r1",
        ruleType: "forbid_regex",
        ruleVersion: 1,
        configDigest: "digest",
      },
      fingerprint: `fp_${id}`,
      fingerprintVersion: 1,
      ...overrides,
    };
  }

  it("ranks by severity first (critical > high > medium > low > info)", () => {
    const fLow = makeFinding("1", { severity: "low" });
    const fCrit = makeFinding("2", { severity: "critical" });
    const fMed = makeFinding("3", { severity: "medium" });
    const fHigh = makeFinding("4", { severity: "high" });
    const fInfo = makeFinding("5", { severity: "info" });

    const ranked = rankFindings([fLow, fCrit, fMed, fHigh, fInfo]);
    expect(ranked.map((f) => f.severity)).toEqual([
      "critical",
      "high",
      "medium",
      "low",
      "info",
    ]);
  });

  it("ranks by scope second when severity is equal (line > file > pull_request)", () => {
    const fPr = makeFinding("pr", {
      severity: "high",
      scope: "pull_request",
      primaryEvidence: {
        kind: "pull_request_metric",
        metric: "changed_files",
        actual: 50,
        threshold: 30,
        comparator: "greater_than",
      },
    });

    const fFile = makeFinding("file", {
      severity: "high",
      scope: "file",
      primaryEvidence: {
        kind: "file_relationship",
        relation: "companion_missing_from_pr",
        sourcePath: "src/a.service.ts",
        expectedPath: "src/a.service.test.ts",
        companionPresentInPr: false,
      },
    });

    const fLine = makeFinding("line", {
      severity: "high",
      scope: "line",
    });

    const ranked = rankFindings([fPr, fFile, fLine]);
    expect(ranked.map((f) => f.scope)).toEqual([
      "line",
      "file",
      "pull_request",
    ]);
  });

  it("ranks by path, line, and code when severity and scope are equal", () => {
    const fZ = makeFinding("z", {
      primaryEvidence: {
        kind: "code_line",
        path: "src/z.ts",
        side: "RIGHT",
        line: 10,
        commitSha: "sha",
        lineHash: "h",
        hunkIndex: 0,
      },
    });
    const fA1 = makeFinding("a1", {
      primaryEvidence: {
        kind: "code_line",
        path: "src/a.ts",
        side: "RIGHT",
        line: 20,
        commitSha: "sha",
        lineHash: "h",
        hunkIndex: 0,
      },
    });
    const fA2 = makeFinding("a2", {
      primaryEvidence: {
        kind: "code_line",
        path: "src/a.ts",
        side: "RIGHT",
        line: 5,
        commitSha: "sha",
        lineHash: "h",
        hunkIndex: 0,
      },
    });

    const ranked = rankFindings([fZ, fA1, fA2]);
    expect(ranked.map((f) => f.fingerprint)).toEqual([
      "fp_a2",
      "fp_a1",
      "fp_z",
    ]);
  });

  it("does not mutate the input array during ranking", () => {
    const list = [makeFinding("b"), makeFinding("a")];
    const originalOrder = [...list];
    rankFindings(list);
    expect(list).toEqual(originalOrder);
  });

  it("groups findings sharing the same anchor (path + side + line + commitSha)", () => {
    const f1 = makeFinding("1", {
      primaryEvidence: {
        kind: "code_line",
        path: "src/same.ts",
        side: "RIGHT",
        line: 10,
        commitSha: "sha1",
        lineHash: "h",
        hunkIndex: 0,
      },
    });
    const f2 = makeFinding("2", {
      primaryEvidence: {
        kind: "code_line",
        path: "src/same.ts",
        side: "RIGHT",
        line: 10,
        commitSha: "sha1",
        lineHash: "h",
        hunkIndex: 0,
      },
    });

    const { inlineGroups } = groupSameAnchorFindings([f1, f2]);
    expect(inlineGroups).toHaveLength(1);
    expect(inlineGroups[0]?.findings).toHaveLength(2);
    expect(inlineGroups[0]?.line).toBe(10);
  });

  it("keeps findings at the same numeric line on different sides separate", () => {
    const fRight = makeFinding("r", {
      primaryEvidence: {
        kind: "code_line",
        path: "src/split.ts",
        side: "RIGHT",
        line: 10,
        commitSha: "sha1",
        lineHash: "h",
        hunkIndex: 0,
      },
    });
    const fLeft = makeFinding("l", {
      primaryEvidence: {
        kind: "code_line",
        path: "src/split.ts",
        side: "LEFT",
        line: 10,
        commitSha: "sha1",
        lineHash: "h",
        hunkIndex: 0,
      },
    });

    const { inlineGroups } = groupSameAnchorFindings([fRight, fLeft]);
    expect(inlineGroups).toHaveLength(2);
  });

  it("enforces default limit of 8 inline groups and suppresses remainder", () => {
    // 10 distinct line findings
    const findings = Array.from({ length: 10 }, (_, i) =>
      makeFinding(String(i), {
        primaryEvidence: {
          kind: "code_line",
          path: `src/f_${i}.ts`,
          side: "RIGHT",
          line: 1,
          commitSha: "sha",
          lineHash: "h",
          hunkIndex: 0,
        },
      }),
    );

    const plan = planPresentation(findings, 8);
    expect(plan.inlineGroups).toHaveLength(8);
    expect(plan.suppressedFindings).toHaveLength(2);
    expect(plan.omittedInlineGroupsCount).toBe(2);
    expect(plan.omittedInlineFindingsCount).toBe(2);
  });

  it("handles max_inline_comments: 0 by presenting all line findings in summary", () => {
    const findings = [
      makeFinding("1", {
        primaryEvidence: {
          kind: "code_line",
          path: "src/a.ts",
          side: "RIGHT",
          line: 10,
          commitSha: "1111111111111111111111111111111111111111",
          lineHash: "hash",
          hunkIndex: 0,
        },
      }),
      makeFinding("2", {
        primaryEvidence: {
          kind: "code_line",
          path: "src/b.ts",
          side: "RIGHT",
          line: 20,
          commitSha: "1111111111111111111111111111111111111111",
          lineHash: "hash",
          hunkIndex: 0,
        },
      }),
    ];
    const plan = planPresentation(findings, 0);

    expect(plan.inlineGroups).toHaveLength(0);
    expect(plan.summaryFindings).toHaveLength(2);
    expect(plan.omittedInlineGroupsCount).toBe(2);
  });

  it("neutralizes @mentions and HTML tags in Markdown output", () => {
    const text =
      "Hello @username, check out <script>alert(1)</script> and <b style='color:red'>bold</b>";
    const sanitized = sanitizeMarkdown(text);

    expect(sanitized).not.toContain("@username");
    expect(sanitized).toContain("@\u200Busername");
    expect(sanitized).not.toContain("<script>");
    expect(sanitized).toContain("&lt;b");
  });

  it("preserves exact ReviewRun marker at the end of the review summary", () => {
    const findings = [makeFinding("1")];
    const plan = planPresentation(findings, 8);
    const payload = buildReviewPayload({
      runId: "run_test_12345",
      plan,
      overallCoverage: "complete",
      coverageWarnings: [],
    });

    expect(payload.summaryBody).toContain(
      "<!-- reviewlens:run:run_test_12345 -->",
    );
    expect(
      payload.summaryBody.endsWith("<!-- reviewlens:run:run_test_12345 -->"),
    ).toBe(true);
  });

  it("enforces bounded review summary size and never truncates the marker", () => {
    // Many findings to exceed summary limits
    const hugeFindings = Array.from({ length: 200 }, (_, i) =>
      makeFinding(String(i), {
        title: "Very Long Finding Title " + "A".repeat(100),
        message:
          "Very Long Finding Message Explaining Details " + "B".repeat(300),
        scope: "file",
        primaryEvidence: {
          kind: "file_relationship",
          relation: "companion_missing_from_pr",
          sourcePath: `src/path_${i}.ts`,
          expectedPath: `src/path_${i}.test.ts`,
          companionPresentInPr: false,
        },
      }),
    );

    const plan = planPresentation(hugeFindings, 8);
    const payload = buildReviewPayload({
      runId: "run_huge_test",
      plan,
      overallCoverage: "complete",
      coverageWarnings: [],
    });

    const byteLen = Buffer.byteLength(payload.summaryBody, "utf8");
    expect(byteLen).toBeLessThanOrEqual(MAX_SUMMARY_BYTES);
    expect(payload.hasOmittedFindingsDueToSize).toBe(true);
    expect(payload.summaryBody).toContain(
      "<!-- reviewlens:run:run_huge_test -->",
    );
    expect(
      payload.summaryBody.endsWith("<!-- reviewlens:run:run_huge_test -->"),
    ).toBe(true);
  });
});
