import { describe, it, expect } from "vitest";
import { evaluateCaseFindings } from "../src/matching/matcher.js";
import { AdjudicationStore } from "../src/matching/adjudication.js";
import type { EvaluationCase } from "../src/dataset/schema.js";
import type { ValidatedFinding } from "@reviewlens/core";

const mockCase: EvaluationCase = {
  caseId: "TEST-CASE-1",
  title: "Test Mock PR Case",
  description: "Mock PR for matcher unit tests",
  language: "typescript",
  purpose: "correctness_reasoning",
  baseSha: "1111111111111111111111111111111111111111",
  headSha: "2222222222222222222222222222222222222222",
  files: [
    {
      path: "src/sample.ts",
      patch: "@@ -1,5 +1,5 @@",
      baseContent: "const x = 1;\n",
      headContent: "const x = 2;\n",
    },
  ],
  expectedFindings: [
    {
      issueId: "EXP-1",
      category: "correctness",
      severity: "high",
      targetPath: "src/sample.ts",
      targetSide: "RIGHT",
      lineRange: { start: 10, end: 12 },
      description: "Expected off-by-one error",
      rootCause: "Comparison operator",
      actionability: "Change < to <=",
      labelStatus: "DRAFT",
    },
  ],
  labelStatus: "DRAFT",
};

function createMockFinding(
  overrides: Partial<ValidatedFinding>,
): ValidatedFinding {
  return {
    schemaVersion: 1,
    code: "AI_CORRECTNESS",
    title: "Off-by-one error detected",
    message: "Loop comparison uses strict inequality",
    severity: "high",
    scope: "line",
    confidence: 0.9,
    fingerprint: "fp-test-1",
    fingerprintVersion: 1,
    origin: {
      kind: "ai_model",
      detectorId: "test-detector",
      detectorVersion: "1.0",
    },
    primaryEvidence: {
      kind: "code_line",
      path: "src/sample.ts",
      side: "RIGHT",
      line: 11,
      commitSha: "2222222222222222222222222222222222222222",
      lineHash: "hash11",
      hunkIndex: 0,
    },
    ...overrides,
  };
}

describe("Matcher — Heuristic Matching and Localization Separation", () => {
  it("matches candidate finding targeting exact line range", () => {
    const finding = createMockFinding({
      primaryEvidence: {
        kind: "code_line",
        path: "src/sample.ts",
        side: "RIGHT",
        line: 11,
        commitSha: "2222222222222222222222222222222222222222",
        lineHash: "hash11",
        hunkIndex: 0,
      },
    });

    const result = evaluateCaseFindings(mockCase, [finding]);
    expect(result.truePositives).toHaveLength(1);
    expect(result.falsePositives).toHaveLength(0);
    expect(result.falseNegatives).toHaveLength(0);

    const mapping = result.allCandidateMappings[0];
    expect(mapping.outcome).toBe("MATCH");
    expect(mapping.matchedIssueId).toBe("EXP-1");
    expect(mapping.isLocalizationAccurate).toBe(true);
    expect(mapping.lineOffset).toBe(0);
  });

  it("matches candidate finding within tolerance offset (e.g. 2 lines away) but records offset", () => {
    const finding = createMockFinding({
      primaryEvidence: {
        kind: "code_line",
        path: "src/sample.ts",
        side: "RIGHT",
        line: 14, // 2 lines beyond end=12
        commitSha: "2222222222222222222222222222222222222222",
        lineHash: "hash14",
        hunkIndex: 0,
      },
    });

    const result = evaluateCaseFindings(mockCase, [finding]);
    expect(result.truePositives).toHaveLength(1);
    const mapping = result.allCandidateMappings[0];
    expect(mapping.outcome).toBe("MATCH");
    expect(mapping.matchedIssueId).toBe("EXP-1");
    expect(mapping.lineOffset).toBe(2);
    expect(mapping.isLocalizationAccurate).toBe(false); // not within exact range 10-12
  });

  it("rejects match if candidate line is too far away (> 5 lines) and marks false positive", () => {
    const finding = createMockFinding({
      primaryEvidence: {
        kind: "code_line",
        path: "src/sample.ts",
        side: "RIGHT",
        line: 30, // 18 lines away
        commitSha: "2222222222222222222222222222222222222222",
        lineHash: "hash30",
        hunkIndex: 0,
      },
    });

    const result = evaluateCaseFindings(mockCase, [finding]);
    expect(result.truePositives).toHaveLength(0);
    expect(result.falsePositives).toHaveLength(1);
    expect(result.falseNegatives).toHaveLength(1); // EXP-1 was missed

    const mapping = result.allCandidateMappings[0];
    expect(mapping.outcome).toBe("FALSE_POSITIVE");
    expect(mapping.matchedIssueId).toBeUndefined();
  });

  it("rejects match if file path does not match", () => {
    const finding = createMockFinding({
      primaryEvidence: {
        kind: "code_line",
        path: "src/different-file.ts",
        side: "RIGHT",
        line: 11,
        commitSha: "2222222222222222222222222222222222222222",
        lineHash: "hash11",
        hunkIndex: 0,
      },
    });

    const result = evaluateCaseFindings(mockCase, [finding]);
    expect(result.truePositives).toHaveLength(0);
    expect(result.falsePositives).toHaveLength(1);
  });

  it("rejects match if diff side does not match (LEFT vs RIGHT)", () => {
    const finding = createMockFinding({
      primaryEvidence: {
        kind: "code_line",
        path: "src/sample.ts",
        side: "LEFT", // Expected is RIGHT
        line: 11,
        commitSha: "2222222222222222222222222222222222222222",
        lineHash: "hash11",
        hunkIndex: 0,
      },
    });

    const result = evaluateCaseFindings(mockCase, [finding]);
    expect(result.truePositives).toHaveLength(0);
    expect(result.falsePositives).toHaveLength(1);
  });

  it("prevents duplicate match inflation: subsequent findings targeting same issue are DUPLICATE", () => {
    const finding1 = createMockFinding({
      fingerprint: "fp-first",
      primaryEvidence: {
        kind: "code_line",
        path: "src/sample.ts",
        side: "RIGHT",
        line: 11,
        commitSha: "2222222222222222222222222222222222222222",
        lineHash: "hash11",
        hunkIndex: 0,
      },
    });
    const finding2 = createMockFinding({
      fingerprint: "fp-second",
      title: "Another finding for same issue",
      primaryEvidence: {
        kind: "code_line",
        path: "src/sample.ts",
        side: "RIGHT",
        line: 12,
        commitSha: "2222222222222222222222222222222222222222",
        lineHash: "hash12",
        hunkIndex: 0,
      },
    });

    const result = evaluateCaseFindings(mockCase, [finding1, finding2]);
    expect(result.truePositives).toHaveLength(1);
    expect(result.duplicates).toHaveLength(1);
    expect(result.falsePositives).toHaveLength(0);
    expect(result.falseNegatives).toHaveLength(0);

    expect(result.allCandidateMappings[0].outcome).toBe("MATCH");
    expect(result.allCandidateMappings[1].outcome).toBe("DUPLICATE");
  });
});

describe("Matcher — Adjudication Store Integration", () => {
  it("prioritizes human adjudication over automated heuristic matching", () => {
    const finding = createMockFinding({
      fingerprint: "fp-overridden",
      primaryEvidence: {
        kind: "code_line",
        path: "src/sample.ts",
        side: "RIGHT",
        line: 11,
        commitSha: "2222222222222222222222222222222222222222",
        lineHash: "hash11",
        hunkIndex: 0,
      },
    });

    // Human adjudicator marks this as FALSE_POSITIVE with notes
    const store = new AdjudicationStore([
      {
        candidateFingerprint: "fp-overridden",
        caseId: mockCase.caseId,
        outcome: "FALSE_POSITIVE",
        reviewerNotes:
          "Human reviewer determined this was intentionally designed",
        adjudicatedAt: new Date().toISOString(),
        adjudicatedBy: "eval-maintainer",
      },
    ]);

    const result = evaluateCaseFindings(mockCase, [finding], store);
    expect(result.falsePositives).toHaveLength(1);
    expect(result.truePositives).toHaveLength(0);
    expect(result.allCandidateMappings[0].outcome).toBe("FALSE_POSITIVE");
    expect(result.allCandidateMappings[0].adjudicationSource).toBe(
      "human_adjudication",
    );
    expect(result.allCandidateMappings[0].reasoning).toContain(
      "Human reviewer determined",
    );
  });

  it("records NEEDS_REVIEW when adjudicated as such", () => {
    const finding = createMockFinding({
      fingerprint: "fp-pending-triage",
    });

    const store = new AdjudicationStore([
      {
        candidateFingerprint: "fp-pending-triage",
        caseId: mockCase.caseId,
        outcome: "NEEDS_REVIEW",
        reviewerNotes: "Awaiting domain team input",
        adjudicatedAt: new Date().toISOString(),
        adjudicatedBy: "triage-bot",
      },
    ]);

    const result = evaluateCaseFindings(mockCase, [finding], store);
    expect(result.unadjudicated).toHaveLength(1);
    expect(result.allCandidateMappings[0].outcome).toBe("NEEDS_REVIEW");
  });
});
