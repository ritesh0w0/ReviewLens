import { describe, it, expect } from "vitest";
import { computeClassificationMetrics } from "../src/metrics/classification.js";
import { computeLocalizationMetrics } from "../src/metrics/localization.js";
import type { CaseMatchResult } from "../src/matching/matcher.js";
import type { ValidatedFinding } from "@reviewlens/core";

function createMockFinding(fingerprint: string): ValidatedFinding {
  return {
    schemaVersion: 1,
    code: "AI_CORRECTNESS",
    title: "Test finding",
    message: "Test message",
    severity: "critical",
    scope: "line",
    confidence: 0.9,
    fingerprint,
    fingerprintVersion: 1,
    origin: {
      kind: "ai_model",
      detectorId: "test",
      detectorVersion: "1.0",
    },
    primaryEvidence: {
      kind: "code_line",
      path: "src/a.ts",
      side: "RIGHT",
      line: 11,
      commitSha: "sha",
      lineHash: "hash",
      hunkIndex: 0,
    },
  };
}

describe("Classification Metrics — Precision, Recall, F1 and Edge Cases", () => {
  it("calculates standard precision, recall, and F1 accurately", () => {
    // 1 case: 1 TP, 1 FP, 1 FN
    const caseResult: CaseMatchResult = {
      caseId: "CASE-M1",
      truePositives: [
        {
          finding: createMockFinding("fp-tp"),
          outcome: "MATCH",
          matchedIssueId: "EXP-1",
          isLocalizationAccurate: true,
          lineOffset: 0,
          adjudicationSource: "automated_proposal",
        },
      ],
      falsePositives: [
        {
          finding: {
            ...createMockFinding("fp-fp"),
            code: "AI_SECURITY",
            severity: "high",
          },
          outcome: "FALSE_POSITIVE",
          isLocalizationAccurate: false,
          lineOffset: 0,
          adjudicationSource: "automated_proposal",
        },
      ],
      falseNegatives: [
        {
          issueId: "EXP-2",
          category: "security",
          severity: "high",
          targetPath: "src/b.ts",
          targetSide: "RIGHT",
          lineRange: { start: 20, end: 25 },
          description: "Missed security bug",
          rootCause: "Cause",
          actionability: "Fix",
          labelStatus: "DRAFT",
        },
      ],
      duplicates: [],
      unadjudicated: [],
      allCandidateMappings: [],
    };

    const metrics = computeClassificationMetrics([caseResult]);
    expect(metrics.totalCases).toBe(1);
    expect(metrics.truePositiveCount).toBe(1);
    expect(metrics.falsePositiveCount).toBe(1);
    expect(metrics.falseNegativeCount).toBe(1);

    // Precision = 1 / (1 + 1) = 0.5
    expect(metrics.precision).toBe(0.5);
    // Recall = 1 / (1 + 1) = 0.5
    expect(metrics.recall).toBe(0.5);
    // F1 = 2 * (0.5 * 0.5) / (0.5 + 0.5) = 0.5
    expect(metrics.f1).toBe(0.5);
    // FP per case = 1 FP / 1 case = 1.0
    expect(metrics.falsePositivesPerCase).toBe(1.0);
  });

  it("handles zero denominator safely without returning NaN or dividing by zero", () => {
    // Empty run with 1 case and 1 FN (no findings generated)
    const emptyResult: CaseMatchResult = {
      caseId: "CASE-EMPTY",
      truePositives: [],
      falsePositives: [],
      falseNegatives: [
        {
          issueId: "EXP-1",
          category: "correctness",
          severity: "critical",
          targetPath: "src/a.ts",
          targetSide: "RIGHT",
          lineRange: { start: 10, end: 12 },
          description: "Bug",
          rootCause: "Cause",
          actionability: "Fix",
          labelStatus: "DRAFT",
        },
      ],
      duplicates: [],
      unadjudicated: [],
      allCandidateMappings: [],
    };

    const metrics = computeClassificationMetrics([emptyResult]);
    expect(metrics.precision).toBeNull(); // TP + FP = 0 -> null
    expect(metrics.recall).toBe(0.0); // TP=0, FN=1 -> 0 / 1 = 0
    expect(metrics.f1).toBeNull();
    expect(metrics.falsePositivesPerCase).toBe(0.0);
  });

  it("handles case where both expected and candidates are empty", () => {
    const cleanCaseResult: CaseMatchResult = {
      caseId: "CASE-CLEAN",
      truePositives: [],
      falsePositives: [],
      falseNegatives: [],
      duplicates: [],
      unadjudicated: [],
      allCandidateMappings: [],
    };

    const metrics = computeClassificationMetrics([cleanCaseResult]);
    expect(metrics.precision).toBeNull();
    expect(metrics.recall).toBeNull(); // No expected issues -> null
    expect(metrics.f1).toBeNull();
    expect(metrics.falsePositivesPerCase).toBe(0.0);
  });

  it("excludes unadjudicated findings from definitive precision and recall", () => {
    const caseResult: CaseMatchResult = {
      caseId: "CASE-UNADJUDICATED",
      truePositives: [
        {
          finding: createMockFinding("fp-tp"),
          outcome: "MATCH",
          matchedIssueId: "EXP-1",
          isLocalizationAccurate: true,
          lineOffset: 0,
          adjudicationSource: "automated_proposal",
        },
      ],
      falsePositives: [],
      falseNegatives: [],
      duplicates: [],
      unadjudicated: [
        {
          finding: createMockFinding("fp-triage"),
          outcome: "NEEDS_REVIEW",
          isLocalizationAccurate: false,
          lineOffset: 0,
          adjudicationSource: "automated_proposal",
        },
      ],
      allCandidateMappings: [],
    };

    const metrics = computeClassificationMetrics([caseResult]);
    expect(metrics.unadjudicatedCount).toBe(1);
    expect(metrics.truePositiveCount).toBe(1);
    expect(metrics.falsePositiveCount).toBe(0);
    // Precision considers adjudicated TP / (TP + FP) = 1 / 1 = 1.0 (unadjudicated excluded)
    expect(metrics.precision).toBe(1.0);
    expect(metrics.recall).toBe(1.0);
  });

  it("produces category and severity breakdowns", () => {
    const caseResult: CaseMatchResult = {
      caseId: "CASE-BREAKDOWN",
      truePositives: [
        {
          finding: createMockFinding("fp-tp"),
          outcome: "MATCH",
          matchedIssueId: "EXP-1",
          isLocalizationAccurate: true,
          lineOffset: 0,
          adjudicationSource: "automated_proposal",
        },
      ],
      falsePositives: [],
      falseNegatives: [
        {
          issueId: "EXP-SEC",
          category: "security",
          severity: "high",
          targetPath: "src/sec.ts",
          targetSide: "RIGHT",
          lineRange: { start: 1, end: 5 },
          description: "Missed sec issue",
          rootCause: "Cause",
          actionability: "Fix",
          labelStatus: "DRAFT",
        },
      ],
      duplicates: [],
      unadjudicated: [],
      allCandidateMappings: [],
    };

    const metrics = computeClassificationMetrics([caseResult]);
    const correctnessCategory = metrics.categoryBreakdown.find(
      (c) => c.category === "correctness",
    );
    const securityCategory = metrics.categoryBreakdown.find(
      (c) => c.category === "security",
    );

    expect(correctnessCategory).toBeDefined();
    expect(correctnessCategory?.tp).toBe(1);
    expect(correctnessCategory?.precision).toBe(1.0);
    expect(correctnessCategory?.recall).toBe(1.0);

    expect(securityCategory).toBeDefined();
    expect(securityCategory?.fn).toBe(1);
    expect(securityCategory?.recall).toBe(0.0);

    const criticalSeverity = metrics.severityBreakdown.find(
      (s) => s.severity === "critical",
    );
    const highSeverity = metrics.severityBreakdown.find(
      (s) => s.severity === "high",
    );

    expect(criticalSeverity?.tp).toBe(1);
    expect(criticalSeverity?.recall).toBe(1.0);
    expect(highSeverity?.fn).toBe(1);
    expect(highSeverity?.recall).toBe(0.0);
  });
});

describe("Localization Metrics", () => {
  it("calculates exact and inexact localization rates and offsets correctly", () => {
    const caseResult: CaseMatchResult = {
      caseId: "CASE-LOC",
      truePositives: [
        {
          finding: createMockFinding("fp-1"),
          outcome: "MATCH",
          matchedIssueId: "EXP-1",
          isLocalizationAccurate: true,
          lineOffset: 0,
          adjudicationSource: "automated_proposal",
        },
        {
          finding: createMockFinding("fp-2"),
          outcome: "MATCH",
          matchedIssueId: "EXP-2",
          isLocalizationAccurate: false,
          lineOffset: 2,
          adjudicationSource: "automated_proposal",
        },
      ],
      falsePositives: [],
      falseNegatives: [],
      duplicates: [],
      unadjudicated: [],
      allCandidateMappings: [],
    };

    const locMetrics = computeLocalizationMetrics([caseResult]);
    expect(locMetrics.totalTruePositives).toBe(2);
    expect(locMetrics.exactLocationCount).toBe(1);
    expect(locMetrics.inexactLocationCount).toBe(1);
    expect(locMetrics.localizationAccuracyRate).toBe(0.5); // 1 exact / 2 total
    expect(locMetrics.meanLineOffset).toBe(1.0); // (0 + 2) / 2
    expect(locMetrics.maxLineOffset).toBe(2);
  });

  it("handles zero true positives safely", () => {
    const locMetrics = computeLocalizationMetrics([]);
    expect(locMetrics.totalTruePositives).toBe(0);
    expect(locMetrics.localizationAccuracyRate).toBeNull();
    expect(locMetrics.meanLineOffset).toBe(0);
    expect(locMetrics.maxLineOffset).toBe(0);
  });
});
