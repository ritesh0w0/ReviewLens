import { describe, it, expect } from "vitest";
import { computeCalibrationMetrics } from "../src/metrics/calibration.js";
import type { CandidateEvaluationMapping } from "../src/matching/matcher.js";
import type { ValidatedFinding } from "@reviewlens/core";

function createCandidateMapping(
  confidence: number,
  outcome:
    | "MATCH"
    | "FALSE_POSITIVE"
    | "NOT_ACTIONABLE"
    | "DUPLICATE"
    | "NEEDS_REVIEW",
): CandidateEvaluationMapping {
  const finding: ValidatedFinding = {
    schemaVersion: 1,
    code: "AI_CORRECTNESS",
    title: "Test finding",
    message: "Test message",
    severity: "high",
    scope: "line",
    confidence,
    fingerprint: `fp-${Math.random()}`,
    fingerprintVersion: 1,
    origin: {
      kind: "ai_model",
      detectorId: "test",
      detectorVersion: "1.0",
    },
    primaryEvidence: {
      kind: "code_line",
      path: "src/sample.ts",
      side: "RIGHT",
      line: 10,
      commitSha: "sha",
      lineHash: "hash",
      hunkIndex: 0,
    },
  };

  return {
    finding,
    outcome,
    isLocalizationAccurate: true,
    lineOffset: 0,
    adjudicationSource: "automated_proposal",
  };
}

describe("Confidence Calibration Metrics (M5 Observational Analysis)", () => {
  it("guards against statistically insignificant sample size (N < 5)", () => {
    // Only 3 samples
    const mappings: CandidateEvaluationMapping[] = [
      createCandidateMapping(0.9, "MATCH"),
      createCandidateMapping(0.8, "MATCH"),
      createCandidateMapping(0.7, "FALSE_POSITIVE"),
    ];

    const calibration = computeCalibrationMetrics(mappings);
    expect(calibration.status).toBe("insufficient_data");
    expect(calibration.sampleCount).toBe(3);
    expect(calibration.brierScore).toBeNull();
    expect(calibration.expectedCalibrationError).toBeNull();
    expect(calibration.caveat).toContain("statistically non-significant");
    expect(calibration.reliabilityBuckets).toHaveLength(5);
  });

  it("calculates Brier score and ECE accurately when sample size is sufficient (N >= 5)", () => {
    // 5 perfectly calibrated samples:
    // 1 sample at 0.9 confidence -> MATCH (outcome=1, error = 0.9 - 1 = -0.1, squared = 0.01)
    // 1 sample at 0.95 confidence -> MATCH (outcome=1, error = 0.95 - 1 = -0.05, squared = 0.0025)
    // 1 sample at 0.85 confidence -> MATCH (outcome=1, error = 0.85 - 1 = -0.15, squared = 0.0225)
    // 1 sample at 0.1 confidence -> FP (outcome=0, error = 0.1 - 0 = 0.1, squared = 0.01)
    // 1 sample at 0.05 confidence -> FP (outcome=0, error = 0.05 - 0 = 0.05, squared = 0.0025)
    const mappings: CandidateEvaluationMapping[] = [
      createCandidateMapping(0.9, "MATCH"),
      createCandidateMapping(0.95, "MATCH"),
      createCandidateMapping(0.85, "MATCH"),
      createCandidateMapping(0.1, "FALSE_POSITIVE"),
      createCandidateMapping(0.05, "FALSE_POSITIVE"),
    ];

    const calibration = computeCalibrationMetrics(mappings);
    expect(calibration.status).toBe("valid");
    expect(calibration.sampleCount).toBe(5);
    expect(calibration.brierScore).toBeDefined();
    expect(calibration.brierScore).not.toBeNull();
    // Brier score should be small since high confidence -> MATCH and low confidence -> FP
    expect(calibration.brierScore!).toBeLessThan(0.05);

    expect(calibration.expectedCalibrationError).toBeDefined();
    expect(calibration.expectedCalibrationError).not.toBeNull();
    expect(calibration.expectedCalibrationError!).toBeLessThan(0.15);
  });

  it("organizes predictions into 5 standard reliability buckets", () => {
    const mappings: CandidateEvaluationMapping[] = [
      createCandidateMapping(0.15, "FALSE_POSITIVE"), // [0.0, 0.2)
      createCandidateMapping(0.35, "MATCH"), // [0.2, 0.4)
      createCandidateMapping(0.55, "MATCH"), // [0.4, 0.6)
      createCandidateMapping(0.75, "MATCH"), // [0.6, 0.8)
      createCandidateMapping(0.95, "MATCH"), // [0.8, 1.0]
    ];

    const calibration = computeCalibrationMetrics(mappings);
    expect(calibration.reliabilityBuckets).toHaveLength(5);

    expect(calibration.reliabilityBuckets[0].binRange).toEqual([0.0, 0.2]);
    expect(calibration.reliabilityBuckets[0].sampleCount).toBe(1);
    expect(calibration.reliabilityBuckets[0].observedAccuracy).toBe(0.0);

    expect(calibration.reliabilityBuckets[4].binRange).toEqual([0.8, 1.0]);
    expect(calibration.reliabilityBuckets[4].sampleCount).toBe(1);
    expect(calibration.reliabilityBuckets[4].observedAccuracy).toBe(1.0);
  });

  it("excludes DUPLICATE and unadjudicated findings from calibration calculation", () => {
    const mappings: CandidateEvaluationMapping[] = [
      createCandidateMapping(0.9, "MATCH"),
      createCandidateMapping(0.85, "MATCH"),
      createCandidateMapping(0.8, "MATCH"),
      createCandidateMapping(0.75, "FALSE_POSITIVE"),
      createCandidateMapping(0.95, "DUPLICATE"), // Should be excluded
      createCandidateMapping(0.6, "NEEDS_REVIEW"), // Should be excluded
    ];

    // Only 4 valid definitive samples -> insufficient data
    const calibration = computeCalibrationMetrics(mappings);
    expect(calibration.status).toBe("insufficient_data");
    expect(calibration.sampleCount).toBe(4);
  });
});
