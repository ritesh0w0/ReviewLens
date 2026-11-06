import { describe, it, expect } from "vitest";
import {
  compareRegressionReports,
  IncompatibleRegressionBaselineError,
} from "../src/runner/regression.js";
import type { EvaluationReport } from "../src/runner/evaluation-runner.js";

function createMockReport(
  overrides: Partial<EvaluationReport>,
): EvaluationReport {
  return {
    manifest: {
      runId: "run-mock",
      datasetId: "reviewlens-benchmark-v1",
      datasetVersion: "1.0.0",
      datasetChecksum: "mock-hash",
      evaluator: "evaluator",
      timestamp: new Date().toISOString(),
      provider: "google",
      modelId: "model-v1",
      promptVersion: "1.0",
      schemaVersion: "1.0",
      casesCount: 8,
      cliVersion: "0.1.0",
    },
    classification: {
      totalCases: 8,
      truePositiveCount: 5,
      falsePositiveCount: 1,
      falseNegativeCount: 1,
      duplicateCount: 0,
      unadjudicatedCount: 0,
      precision: 0.833,
      recall: 0.833,
      f1: 0.833,
      falsePositivesPerCase: 0.125,
      categoryBreakdown: [],
      severityBreakdown: [],
    },
    localization: {
      totalTruePositives: 5,
      exactLocationCount: 5,
      inexactLocationCount: 0,
      localizationAccuracyRate: 1.0,
      meanLineOffset: 0,
      maxLineOffset: 0,
    },
    calibration: {
      status: "valid",
      sampleCount: 6,
      brierScore: 0.12,
      expectedCalibrationError: 0.08,
      reliabilityBuckets: [],
      caveat: "Sample size caution",
    },
    evidenceIntegrity: {
      totalCandidatesGenerated: 6,
      totalCandidatesValidated: 6,
      totalEvidencePassed: 6,
      totalEvidenceRejected: 0,
      evidencePassRate: 1.0,
    },
    executionSummary: {
      totalCases: 8,
      completedCases: 8,
      failedCases: 0,
      totalLatencyMs: 1000,
      meanLatencyMs: 125,
      totalTokensIn: 2000,
      totalTokensOut: 500,
      fallbackOccurredCount: 0,
    },
    caseResults: [],
    ...overrides,
  };
}

describe("Regression Comparison Engine", () => {
  it("detects no regression when candidate maintains or improves metrics", () => {
    const baseline = createMockReport({
      manifest: {
        ...createMockReport({}).manifest,
        runId: "baseline-run",
      },
      classification: {
        ...createMockReport({}).classification,
        precision: 0.8,
        recall: 0.8,
        f1: 0.8,
        falsePositivesPerCase: 0.2,
      },
    });

    const candidate = createMockReport({
      manifest: {
        ...createMockReport({}).manifest,
        runId: "candidate-run",
      },
      classification: {
        ...createMockReport({}).classification,
        precision: 0.9, // Improved
        recall: 0.9, // Improved
        f1: 0.9, // Improved
        falsePositivesPerCase: 0.1, // Improved (lower)
      },
    });

    const diff = compareRegressionReports(baseline, candidate);
    expect(diff.hasAnyRegression).toBe(false);
    expect(diff.precision.isRegression).toBe(false);
    expect(diff.recall.isRegression).toBe(false);
    expect(diff.falsePositivesPerCase.isRegression).toBe(false);
    expect(diff.summary).toContain(
      "maintains or improves all primary quality metrics",
    );
  });

  it("detects regressions when precision or recall drop", () => {
    const baseline = createMockReport({
      manifest: { ...createMockReport({}).manifest, runId: "baseline-run" },
      classification: {
        ...createMockReport({}).classification,
        precision: 0.85,
        recall: 0.85,
        f1: 0.85,
        falsePositivesPerCase: 0.1,
      },
    });

    const candidate = createMockReport({
      manifest: { ...createMockReport({}).manifest, runId: "candidate-run" },
      classification: {
        ...createMockReport({}).classification,
        precision: 0.7, // Dropped
        recall: 0.85,
        f1: 0.77, // Dropped
        falsePositivesPerCase: 0.3, // Increased (regression)
      },
    });

    const diff = compareRegressionReports(baseline, candidate);
    expect(diff.hasAnyRegression).toBe(true);
    expect(diff.precision.isRegression).toBe(true);
    expect(diff.precision.delta).toBeCloseTo(-0.15, 2);
    expect(diff.falsePositivesPerCase.isRegression).toBe(true);
    expect(diff.falsePositivesPerCase.delta).toBeCloseTo(0.2, 2);
    expect(diff.summary).toContain("Regressions detected");
  });

  it("rejects comparison across incompatible datasets", () => {
    const baseline = createMockReport({
      manifest: {
        ...createMockReport({}).manifest,
        datasetId: "reviewlens-benchmark-v1",
        datasetVersion: "1.0.0",
      },
    });

    const candidate = createMockReport({
      manifest: {
        ...createMockReport({}).manifest,
        datasetId: "reviewlens-benchmark-v2", // Different dataset
        datasetVersion: "2.0.0",
      },
    });

    expect(() => compareRegressionReports(baseline, candidate)).toThrow(
      IncompatibleRegressionBaselineError,
    );
  });

  it("handles null metrics gracefully without crashing", () => {
    const baseline = createMockReport({
      classification: {
        ...createMockReport({}).classification,
        precision: null,
        recall: null,
        f1: null,
      },
    });

    const candidate = createMockReport({
      classification: {
        ...createMockReport({}).classification,
        precision: 0.8,
        recall: 0.8,
        f1: 0.8,
      },
    });

    const diff = compareRegressionReports(baseline, candidate);
    expect(diff.precision.delta).toBeNull();
    expect(diff.precision.isRegression).toBe(false);
  });
});
