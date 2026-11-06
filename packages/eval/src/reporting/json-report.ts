import type { EvaluationReport } from "../runner/evaluation-runner.js";
import type { RegressionComparisonReport } from "../runner/regression.js";

export function generateJsonReport(
  report: EvaluationReport,
  regression?: RegressionComparisonReport,
): string {
  const output = {
    ...report,
    regression: regression ?? null,
  };
  return JSON.stringify(output, null, 2);
}
