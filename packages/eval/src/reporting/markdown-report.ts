import type { EvaluationReport } from "../runner/evaluation-runner.js";
import type { RegressionComparisonReport } from "../runner/regression.js";

function formatPercent(val: number | null): string {
  if (val === null) return "N/A";
  return `${(val * 100).toFixed(1)}%`;
}

function formatDecimal(val: number | null, digits: number = 3): string {
  if (val === null) return "N/A";
  return val.toFixed(digits);
}

export function generateMarkdownReport(
  report: EvaluationReport,
  regression?: RegressionComparisonReport,
): string {
  const {
    manifest,
    executionSummary,
    classification,
    localization,
    calibration,
    caseResults,
  } = report;

  const lines: string[] = [];

  lines.push(`# ReviewLens Evaluation Report — ${manifest.runId}`);
  lines.push("");
  lines.push(`**Generated:** ${manifest.timestamp}  `);
  lines.push(`**Evaluator:** ${manifest.evaluator}  `);
  lines.push(
    `**Model / Provider:** \`${manifest.modelId}\` (${manifest.provider})  `,
  );
  lines.push(
    `**Dataset:** \`${manifest.datasetId}\` (v${manifest.datasetVersion})  `,
  );
  lines.push(
    `**Prompt Version:** \`${manifest.promptVersion}\` | **Schema Version:** \`${manifest.schemaVersion}\``,
  );
  lines.push("");
  lines.push("---");
  lines.push("");

  lines.push("## 1. Executive Metrics Summary");
  lines.push("");
  lines.push("| Metric | Value | Description |");
  lines.push("| :--- | :--- | :--- |");
  lines.push(
    `| **Precision** | **${formatPercent(classification.precision)}** | Genuine defects / all reported findings |`,
  );
  lines.push(
    `| **Recall** | **${formatPercent(classification.recall)}** | Genuine defects detected / all expected defects |`,
  );
  lines.push(
    `| **F1 Score** | **${formatDecimal(classification.f1)}** | Harmonic mean of precision and recall |`,
  );
  lines.push(
    `| **False Positives / Case** | **${classification.falsePositivesPerCase.toFixed(2)}** | Average false alarms per evaluated PR scenario |`,
  );
  lines.push(
    `| **True Positives (TP)** | ${classification.truePositiveCount} | Correctly identified expected issues |`,
  );
  lines.push(
    `| **False Positives (FP)** | ${classification.falsePositiveCount} | Inaccurate, cosmetic, or hallucinated findings |`,
  );
  lines.push(
    `| **False Negatives (FN)** | ${classification.falseNegativeCount} | Expected genuine defects missed |`,
  );
  lines.push(
    `| **Duplicate Findings** | ${classification.duplicateCount} | Redundant findings (excluded from TP inflation) |`,
  );
  lines.push(
    `| **Awaiting Review** | ${classification.unadjudicatedCount} | Unadjudicated findings (excluded from definitive metrics) |`,
  );
  lines.push("");

  if (classification.unadjudicatedCount > 0) {
    lines.push(`> [!NOTE]`);
    lines.push(
      `> ${classification.unadjudicatedCount} candidate finding(s) have not yet received human adjudication and are excluded from definitive precision/recall scores.`,
    );
    lines.push("");
  }

  lines.push("## 2. Localization & Evidence Integrity");
  lines.push("");
  lines.push("| Metric | Value | Meaning |");
  lines.push("| :--- | :--- | :--- |");
  lines.push(
    `| **Localization Accuracy** | ${formatPercent(localization.localizationAccuracyRate)} | Percentage of true positives targeting exact line range |`,
  );
  lines.push(
    `| **Mean Line Offset** | ${localization.meanLineOffset.toFixed(1)} lines | Average line distance from target defect anchor |`,
  );
  lines.push(
    `| **Max Line Offset** | ${localization.maxLineOffset} lines | Maximum observed line drift on true positive findings |`,
  );
  lines.push(
    `| **Evidence Validation Pass Rate** | ${formatPercent(executionSummary.evidenceValidationPassRate)} | Percentage of candidates passing M4 diff evidence checks |`,
  );
  lines.push("");
  lines.push("> [!IMPORTANT]");
  lines.push(
    "> **Evidence validity and semantic correctness are distinct.** Evidence validation pass rate reflects code line existence and quote verification; it does not indicate whether a finding is semantically genuine.",
  );
  lines.push("");

  lines.push("## 3. Performance by Defect Category");
  lines.push("");
  lines.push("| Category | Precision | Recall | F1 | TP | FP | FN |");
  lines.push("| :--- | :--- | :--- | :--- | :--- | :--- | :--- |");
  for (const cat of classification.categoryBreakdown) {
    lines.push(
      `| \`${cat.category}\` | ${formatPercent(cat.precision)} | ${formatPercent(cat.recall)} | ${formatDecimal(cat.f1)} | ${cat.tp} | ${cat.fp} | ${cat.fn} |`,
    );
  }
  lines.push("");

  lines.push("## 4. Performance by Defect Severity");
  lines.push("");
  lines.push(
    "| Severity | Expected Issues Detected | Expected Issues Missed | Recall |",
  );
  lines.push("| :--- | :--- | :--- | :--- |");
  for (const sev of classification.severityBreakdown) {
    lines.push(
      `| \`${sev.severity}\` | ${sev.tp} | ${sev.fn} | ${formatPercent(sev.recall)} |`,
    );
  }
  lines.push("");

  lines.push("## 5. Confidence Calibration (M5 Observational Analysis)");
  lines.push("");
  lines.push(`- **Status:** \`${calibration.status}\``);
  lines.push(
    `- **Sample Count:** ${calibration.sampleCount} predictions with confidence scores`,
  );
  lines.push(
    `- **Brier Score:** ${calibration.brierScore !== null ? calibration.brierScore.toFixed(4) : "N/A"}`,
  );
  lines.push(
    `- **Expected Calibration Error (ECE):** ${calibration.expectedCalibrationError !== null ? formatPercent(calibration.expectedCalibrationError) : "N/A"}`,
  );
  lines.push("");
  lines.push(
    "| Confidence Bin | Predictions | Mean Confidence | Observed Accuracy |",
  );
  lines.push("| :--- | :--- | :--- | :--- |");
  for (const b of calibration.reliabilityBuckets) {
    lines.push(
      `| [${b.binRange[0]}, ${b.binRange[1]}) | ${b.sampleCount} | ${formatPercent(b.meanConfidence)} | ${formatPercent(b.observedAccuracy)} |`,
    );
  }
  lines.push("");
  lines.push(`> [!NOTE]`);
  lines.push(`> ${calibration.caveat}`);
  lines.push("");

  if (regression) {
    lines.push("## 6. Regression Baseline Comparison");
    lines.push("");
    lines.push(
      `**Baseline Run:** \`${regression.baselineRunId}\` (\`${regression.baselineModelId}\`)  `,
    );
    lines.push(`**Summary:** ${regression.summary}`);
    lines.push("");
    lines.push("| Metric | Baseline | Candidate | Delta | Status |");
    lines.push("| :--- | :--- | :--- | :--- | :--- |");
    lines.push(
      `| Precision | ${formatPercent(regression.precision.baseline)} | ${formatPercent(regression.precision.candidate)} | ${regression.precision.delta !== null ? (regression.precision.delta * 100).toFixed(1) + "%" : "N/A"} | ${regression.precision.isRegression ? "⚠️ REGRESSION" : "✅ OK"} |`,
    );
    lines.push(
      `| Recall | ${formatPercent(regression.recall.baseline)} | ${formatPercent(regression.recall.candidate)} | ${regression.recall.delta !== null ? (regression.recall.delta * 100).toFixed(1) + "%" : "N/A"} | ${regression.recall.isRegression ? "⚠️ REGRESSION" : "✅ OK"} |`,
    );
    lines.push(
      `| F1 Score | ${formatDecimal(regression.f1.baseline)} | ${formatDecimal(regression.f1.candidate)} | ${regression.f1.delta !== null ? regression.f1.delta.toFixed(3) : "N/A"} | ${regression.f1.isRegression ? "⚠️ REGRESSION" : "✅ OK"} |`,
    );
    lines.push(
      `| FP / Case | ${formatDecimal(regression.falsePositivesPerCase.baseline, 2)} | ${formatDecimal(regression.falsePositivesPerCase.candidate, 2)} | ${regression.falsePositivesPerCase.delta !== null ? regression.falsePositivesPerCase.delta.toFixed(2) : "N/A"} | ${regression.falsePositivesPerCase.isRegression ? "⚠️ REGRESSION" : "✅ OK"} |`,
    );
    lines.push(
      `| Localization Rate | ${formatPercent(regression.localizationAccuracy.baseline)} | ${formatPercent(regression.localizationAccuracy.candidate)} | ${regression.localizationAccuracy.delta !== null ? (regression.localizationAccuracy.delta * 100).toFixed(1) + "%" : "N/A"} | ${regression.localizationAccuracy.isRegression ? "⚠️ REGRESSION" : "✅ OK"} |`,
    );
    lines.push("");
  }

  lines.push("## 7. Per-Case Execution & Matching Breakdown");
  lines.push("");
  lines.push("| Case ID | TP | FP | FN | Dup | Review | Status |");
  lines.push("| :--- | :--- | :--- | :--- | :--- | :--- | :--- |");
  for (const cr of caseResults) {
    const status =
      cr.falseNegatives.length === 0 && cr.falsePositives.length === 0
        ? "✅ PASSED"
        : "⚠️ ISSUES";
    lines.push(
      `| \`${cr.caseId}\` | ${cr.truePositives.length} | ${cr.falsePositives.length} | ${cr.falseNegatives.length} | ${cr.duplicates.length} | ${cr.unadjudicated.length} | ${status} |`,
    );
  }
  lines.push("");

  lines.push("## 8. Operational & Token Footprint");
  lines.push("");
  lines.push(
    `- **Total PR Cases:** ${executionSummary.totalCases} (${executionSummary.completedCases} completed, ${executionSummary.failedCases} failed)`,
  );
  lines.push(
    `- **Total Ingestion Latency:** ${executionSummary.totalLatencyMs}ms (mean: ${executionSummary.meanLatencyMs.toFixed(0)}ms/case)`,
  );
  lines.push(
    `- **Input Tokens Used:** ${executionSummary.totalTokensIn.toLocaleString()}`,
  );
  lines.push(
    `- **Output Tokens Used:** ${executionSummary.totalTokensOut.toLocaleString()}`,
  );
  lines.push(
    `- **Candidate Findings Generated:** ${executionSummary.totalCandidatesGenerated}`,
  );
  lines.push(
    `- **Candidate Findings Validated:** ${executionSummary.totalCandidatesValidated}`,
  );
  lines.push(
    `- **Model Fallbacks Triggered:** ${executionSummary.fallbackCount}`,
  );
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push("### Methodological & Reproducibility Notice");
  lines.push(
    "- This report was generated offline using deterministic evaluation tooling.",
  );
  lines.push(
    "- Ground-truth expected findings are labeled under initial `DRAFT` status pending project owner review.",
  );
  lines.push(
    "- No live model provider calls (Gemini/Groq) or GitHub write APIs were invoked during evaluation.",
  );

  return lines.join("\n");
}
