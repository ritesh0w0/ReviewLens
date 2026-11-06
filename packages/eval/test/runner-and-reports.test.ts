import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { runEvaluation } from "../src/runner/evaluation-runner.js";
import { loadEvaluationRunInputFromFile } from "../src/runner/result-loader.js";
import { generateMarkdownReport } from "../src/reporting/markdown-report.js";
import { generateJsonReport } from "../src/reporting/json-report.js";
import { compareRegressionReports } from "../src/runner/regression.js";
import { defaultDatasetRegistry } from "../src/dataset/loader.js";

describe("Evaluation Runner, Reporting, and Sanitization", () => {
  const baselineFixturePath = path.resolve(
    __dirname,
    "../fixtures/sample-baseline-run.json",
  );
  const candidateFixturePath = path.resolve(
    __dirname,
    "../fixtures/sample-candidate-run.json",
  );

  it("loads and parses sample baseline run fixture cleanly", () => {
    const input = loadEvaluationRunInputFromFile(baselineFixturePath);
    expect(input.runId).toBe("eval-run-20261106-baseline-flash-lite");
    expect(input.caseResults).toHaveLength(8);
  });

  it("executes full evaluation pipeline on baseline fixture", () => {
    const input = loadEvaluationRunInputFromFile(baselineFixturePath);
    const report = runEvaluation(input, {
      datasetRegistry: defaultDatasetRegistry,
    });

    expect(report.manifest.runId).toBe("eval-run-20261106-baseline-flash-lite");
    expect(report.manifest.datasetId).toBe("reviewlens-benchmark-v1");
    expect(report.manifest.datasetChecksum).toMatch(/^[a-f0-9]{64}$/); // SHA-256
    expect(report.classification.totalCases).toBe(8);
    expect(report.classification.truePositiveCount).toBe(5);
    expect(report.classification.falsePositiveCount).toBe(1);
    expect(report.classification.falseNegativeCount).toBe(1);
    expect(report.classification.precision).toBeCloseTo(0.833, 2);
    expect(report.classification.recall).toBeCloseTo(0.833, 2);
    expect(report.localization.localizationAccuracyRate).toBe(1.0);
  });

  it("generates GFM markdown report with manifest, alerts, tables, and without leaking prompts or keys", () => {
    const input = loadEvaluationRunInputFromFile(baselineFixturePath);
    const report = runEvaluation(input, {
      datasetRegistry: defaultDatasetRegistry,
    });
    const markdown = generateMarkdownReport(report);

    // Structural elements
    expect(markdown).toContain("# ReviewLens Evaluation Report");
    expect(markdown).toContain("## 1. Executive Metrics Summary");
    expect(markdown).toContain("## 2. Localization & Evidence Integrity");
    expect(markdown).toContain("## 3. Performance by Defect Category");
    expect(markdown).toContain("## 4. Performance by Defect Severity");
    expect(markdown).toContain("## 5. Confidence Calibration");
    expect(markdown).toContain("## 7. Per-Case Execution & Matching Breakdown");

    // Distinguishing evidence validity from semantic correctness alert
    expect(markdown).toContain(
      "Evidence validity and semantic correctness are distinct.",
    );

    // Sanitization checks: ensure zero raw prompts, zero keys, zero sensitive variables
    expect(markdown).not.toMatch(/GEMINI_API_KEY/i);
    expect(markdown).not.toMatch(/GROQ_API_KEY/i);
    expect(markdown).not.toMatch(/AIza[0-9A-Za-z-_]{35}/);
    expect(markdown).not.toMatch(/gsk_[0-9A-Za-z]{32}/);
  });

  it("generates valid JSON report matching schema", () => {
    const input = loadEvaluationRunInputFromFile(baselineFixturePath);
    const report = runEvaluation(input, {
      datasetRegistry: defaultDatasetRegistry,
    });
    const jsonStr = generateJsonReport(report);
    const parsed = JSON.parse(jsonStr);

    expect(parsed.manifest.runId).toBe("eval-run-20261106-baseline-flash-lite");
    expect(parsed.classification.truePositiveCount).toBe(5);
    expect(parsed.executionSummary.evidenceValidationPassRate).toBe(1.0);
    expect(parsed.manifest.datasetChecksum).toBeDefined();
  });

  it("generates regression delta sections in markdown when baseline is provided", () => {
    const baselineInput = loadEvaluationRunInputFromFile(baselineFixturePath);
    const candidateInput = loadEvaluationRunInputFromFile(candidateFixturePath);

    const baselineReport = runEvaluation(baselineInput, {
      datasetRegistry: defaultDatasetRegistry,
    });
    const candidateReport = runEvaluation(candidateInput, {
      datasetRegistry: defaultDatasetRegistry,
    });

    const regression = compareRegressionReports(
      baselineReport,
      candidateReport,
    );
    const markdown = generateMarkdownReport(candidateReport, regression);

    expect(markdown).toContain("## 6. Regression Baseline Comparison");
    expect(markdown).toContain(
      "maintains or improves all primary quality metrics over baseline",
    );
    expect(markdown).toContain(
      "| Precision | 83.3% | 100.0% | 16.7% | ✅ OK |",
    );
  });
});
