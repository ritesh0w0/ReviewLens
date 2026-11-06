import type { EvaluationReport } from "./evaluation-runner.js";

export class IncompatibleRegressionBaselineError extends Error {
  readonly code = "INCOMPATIBLE_REGRESSION_BASELINE";
  constructor(message: string) {
    super(message);
    this.name = "IncompatibleRegressionBaselineError";
  }
}

export interface MetricDelta {
  readonly baseline: number | null;
  readonly candidate: number | null;
  readonly delta: number | null;
  readonly isRegression: boolean;
}

export interface RegressionComparisonReport {
  readonly baselineRunId: string;
  readonly candidateRunId: string;
  readonly datasetId: string;
  readonly datasetVersion: string;
  readonly baselineModelId: string;
  readonly candidateModelId: string;
  readonly precision: MetricDelta;
  readonly recall: MetricDelta;
  readonly f1: MetricDelta;
  readonly falsePositivesPerCase: MetricDelta;
  readonly localizationAccuracy: MetricDelta;
  readonly meanLatencyMs: MetricDelta;
  readonly totalTokensIn: MetricDelta;
  readonly totalTokensOut: MetricDelta;
  readonly hasAnyRegression: boolean;
  readonly summary: string;
}

function computeDelta(
  baseline: number | null,
  candidate: number | null,
  higherIsBetter: boolean = true,
): MetricDelta {
  if (baseline === null || candidate === null) {
    return {
      baseline,
      candidate,
      delta: null,
      isRegression: false,
    };
  }

  const delta = Number((candidate - baseline).toFixed(4));
  const isRegression = higherIsBetter ? delta < -0.0001 : delta > 0.0001;

  return {
    baseline,
    candidate,
    delta,
    isRegression,
  };
}

export function compareRegressionReports(
  baseline: EvaluationReport,
  candidate: EvaluationReport,
): RegressionComparisonReport {
  if (
    baseline.manifest.datasetId !== candidate.manifest.datasetId ||
    baseline.manifest.datasetVersion !== candidate.manifest.datasetVersion
  ) {
    throw new IncompatibleRegressionBaselineError(
      `Cannot compare runs across different datasets: baseline (${baseline.manifest.datasetId}@${baseline.manifest.datasetVersion}) vs candidate (${candidate.manifest.datasetId}@${candidate.manifest.datasetVersion})`,
    );
  }

  const precision = computeDelta(
    baseline.classification.precision,
    candidate.classification.precision,
    true,
  );
  const recall = computeDelta(
    baseline.classification.recall,
    candidate.classification.recall,
    true,
  );
  const f1 = computeDelta(
    baseline.classification.f1,
    candidate.classification.f1,
    true,
  );
  const falsePositivesPerCase = computeDelta(
    baseline.classification.falsePositivesPerCase,
    candidate.classification.falsePositivesPerCase,
    false, // lower is better
  );
  const localizationAccuracy = computeDelta(
    baseline.localization.localizationAccuracyRate,
    candidate.localization.localizationAccuracyRate,
    true,
  );
  const meanLatencyMs = computeDelta(
    baseline.executionSummary.meanLatencyMs,
    candidate.executionSummary.meanLatencyMs,
    false, // lower is better
  );
  const totalTokensIn = computeDelta(
    baseline.executionSummary.totalTokensIn,
    candidate.executionSummary.totalTokensIn,
    false, // lower is better
  );
  const totalTokensOut = computeDelta(
    baseline.executionSummary.totalTokensOut,
    candidate.executionSummary.totalTokensOut,
    false, // lower is better
  );

  const hasAnyRegression =
    precision.isRegression ||
    recall.isRegression ||
    f1.isRegression ||
    falsePositivesPerCase.isRegression ||
    localizationAccuracy.isRegression;

  let summary: string;
  if (!hasAnyRegression) {
    summary = `Candidate run '${candidate.manifest.runId}' maintains or improves all primary quality metrics over baseline '${baseline.manifest.runId}'.`;
  } else {
    const regressions: string[] = [];
    if (precision.isRegression)
      regressions.push(`Precision dropped (${precision.delta})`);
    if (recall.isRegression)
      regressions.push(`Recall dropped (${recall.delta})`);
    if (f1.isRegression) regressions.push(`F1 dropped (${f1.delta})`);
    if (falsePositivesPerCase.isRegression)
      regressions.push(
        `False positives increased (+${falsePositivesPerCase.delta})`,
      );
    if (localizationAccuracy.isRegression)
      regressions.push(
        `Localization accuracy dropped (${localizationAccuracy.delta})`,
      );
    summary = `Regressions detected in candidate run '${candidate.manifest.runId}': ${regressions.join(", ")}.`;
  }

  return {
    baselineRunId: baseline.manifest.runId,
    candidateRunId: candidate.manifest.runId,
    datasetId: baseline.manifest.datasetId,
    datasetVersion: baseline.manifest.datasetVersion,
    baselineModelId: baseline.manifest.modelId,
    candidateModelId: candidate.manifest.modelId,
    precision,
    recall,
    f1,
    falsePositivesPerCase,
    localizationAccuracy,
    meanLatencyMs,
    totalTokensIn,
    totalTokensOut,
    hasAnyRegression,
    summary,
  };
}
