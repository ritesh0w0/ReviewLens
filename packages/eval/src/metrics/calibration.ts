import type { CandidateEvaluationMapping } from "../matching/matcher.js";

export interface ReliabilityBucket {
  readonly binRange: [number, number];
  readonly sampleCount: number;
  readonly meanConfidence: number | null;
  readonly observedAccuracy: number | null;
}

export interface CalibrationMetrics {
  readonly status: "valid" | "insufficient_data";
  readonly sampleCount: number;
  readonly brierScore: number | null;
  readonly expectedCalibrationError: number | null;
  readonly reliabilityBuckets: readonly ReliabilityBucket[];
  readonly caveat: string;
}

export function computeCalibrationMetrics(
  mappings: readonly CandidateEvaluationMapping[],
  options?: { minSampleSize?: number; bucketCount?: number },
): CalibrationMetrics {
  const minSampleSize = options?.minSampleSize ?? 5;
  const bucketCount = options?.bucketCount ?? 5;

  // Filter candidates that have valid, finite confidence scores and definitive adjudication
  const scoredCandidates = mappings.filter((m) => {
    const conf = m.finding.confidence;
    return (
      typeof conf === "number" &&
      Number.isFinite(conf) &&
      conf >= 0 &&
      conf <= 1 &&
      (m.outcome === "MATCH" ||
        m.outcome === "FALSE_POSITIVE" ||
        m.outcome === "NOT_ACTIONABLE")
    );
  });

  const sampleCount = scoredCandidates.length;

  // Prepare standard 5 equal-width bins: [0, 0.2), [0.2, 0.4), [0.4, 0.6), [0.6, 0.8), [0.8, 1.0]
  const buckets: ReliabilityBucket[] = [];
  const binWidth = 1.0 / bucketCount;

  for (let i = 0; i < bucketCount; i++) {
    const lower = Number((i * binWidth).toFixed(2));
    const upper = Number(((i + 1) * binWidth).toFixed(2));
    const inBin = scoredCandidates.filter((c) => {
      const conf = c.finding.confidence!;
      return i === bucketCount - 1
        ? conf >= lower && conf <= upper
        : conf >= lower && conf < upper;
    });

    if (inBin.length === 0) {
      buckets.push({
        binRange: [lower, upper],
        sampleCount: 0,
        meanConfidence: null,
        observedAccuracy: null,
      });
    } else {
      const sumConf = inBin.reduce((acc, c) => acc + c.finding.confidence!, 0);
      const sumCorrect = inBin.filter((c) => c.outcome === "MATCH").length;
      buckets.push({
        binRange: [lower, upper],
        sampleCount: inBin.length,
        meanConfidence: sumConf / inBin.length,
        observedAccuracy: sumCorrect / inBin.length,
      });
    }
  }

  // Statistical confidence calibration requires adequate sample size
  if (sampleCount < minSampleSize) {
    return {
      status: "insufficient_data",
      sampleCount,
      brierScore: null,
      expectedCalibrationError: null,
      reliabilityBuckets: buckets,
      caveat: `Evaluation contains ${sampleCount} predictions with confidence scores (minimum required: ${minSampleSize}). Calibration metrics are statistically non-significant on small datasets. Confidence is recorded for observation only.`,
    };
  }

  // Calculate Brier Score: mean squared error between confidence and binary outcome (1 for MATCH, 0 for FP)
  let sumSquaredError = 0;
  for (const c of scoredCandidates) {
    const outcomeBinary = c.outcome === "MATCH" ? 1.0 : 0.0;
    const error = c.finding.confidence! - outcomeBinary;
    sumSquaredError += error * error;
  }
  const brierScore = sumSquaredError / sampleCount;

  // Calculate Expected Calibration Error (ECE): weighted average of |accuracy - confidence| across non-empty bins
  let weightedEce = 0;
  for (const b of buckets) {
    if (
      b.sampleCount > 0 &&
      b.observedAccuracy !== null &&
      b.meanConfidence !== null
    ) {
      const binWeight = b.sampleCount / sampleCount;
      const binError = Math.abs(b.observedAccuracy - b.meanConfidence);
      weightedEce += binWeight * binError;
    }
  }

  return {
    status: "valid",
    sampleCount,
    brierScore,
    expectedCalibrationError: weightedEce,
    reliabilityBuckets: buckets,
    caveat:
      "Calibration computed across evaluation dataset predictions. Caution: 8-case synthetic benchmark sample size remains small; confidence calibration should be re-evaluated as dataset expands.",
  };
}
