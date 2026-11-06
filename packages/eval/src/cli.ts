#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultDatasetRegistry } from "./dataset/loader.js";
import { BENCHMARK_DATASET_V1 } from "./dataset/v1/index.js";
import { loadEvaluationRunInputFromFile } from "./runner/result-loader.js";
import { runEvaluation } from "./runner/evaluation-runner.js";
import { compareRegressionReports } from "./runner/regression.js";
import { generateMarkdownReport } from "./reporting/markdown-report.js";
import { generateJsonReport } from "./reporting/json-report.js";
import type { EvaluationRunInput } from "./runner/input-schema.js";
import type { AdjudicationRecord } from "./matching/adjudication.js";

function printUsage(): void {
  console.log(`
ReviewLens M5 Evaluation CLI
Usage:
  reviewlens-eval [options]

Options:
  --input <path>          Path to evaluation run input JSON file
  --adjudications <path>  Path to human adjudications JSON file
  --baseline <path>       Path to baseline evaluation report JSON for regression diff
  --out-md <path>         Path to write Markdown evaluation report
  --out-json <path>       Path to write JSON evaluation report
  --help                  Show this help text
`);
}

function parseArgs(args: string[]): {
  inputPath?: string;
  adjudicationsPath?: string;
  baselinePath?: string;
  outMdPath?: string;
  outJsonPath?: string;
  help?: boolean;
} {
  const result: {
    inputPath?: string;
    adjudicationsPath?: string;
    baselinePath?: string;
    outMdPath?: string;
    outJsonPath?: string;
    help?: boolean;
  } = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--input" && i + 1 < args.length) {
      result.inputPath = args[++i];
    } else if (arg === "--adjudications" && i + 1 < args.length) {
      result.adjudicationsPath = args[++i];
    } else if (arg === "--baseline" && i + 1 < args.length) {
      result.baselinePath = args[++i];
    } else if (arg === "--out-md" && i + 1 < args.length) {
      result.outMdPath = args[++i];
    } else if (arg === "--out-json" && i + 1 < args.length) {
      result.outJsonPath = args[++i];
    }
  }

  return result;
}

export function createDefaultOfflineInput(): EvaluationRunInput {
  // Generates a reference deterministic baseline run for dataset v1
  return {
    runId: "run-m5-offline-baseline",
    datasetId: BENCHMARK_DATASET_V1.datasetId,
    datasetVersion: BENCHMARK_DATASET_V1.version,
    evaluator: "reviewlens-offline-harness",
    timestamp: new Date().toISOString(),
    provider: "deterministic",
    modelId: "reviewlens-rules-baseline",
    promptVersion: "1.0",
    schemaVersion: "1.0",
    caseResults: BENCHMARK_DATASET_V1.cases.map((c) => ({
      caseId: c.caseId,
      executionStatus: "COMPLETE" as const,
      acceptedFindings: [],
      candidatesGenerated: 0,
      candidatesValidated: 0,
      evidencePassed: 0,
      evidenceRejected: 0,
      latencyMs: 15,
      tokensIn: 0,
      tokensOut: 0,
      fallbackOccurred: false,
    })),
  };
}

export function runCli(argv: string[] = process.argv.slice(2)): void {
  const options = parseArgs(argv);

  if (options.help) {
    printUsage();
    return;
  }

  let input: EvaluationRunInput;
  if (options.inputPath) {
    input = loadEvaluationRunInputFromFile(options.inputPath);
  } else {
    console.log(
      "No --input provided; running with default offline deterministic baseline input...",
    );
    input = createDefaultOfflineInput();
  }

  let adjudications: AdjudicationRecord[] = [];
  if (options.adjudicationsPath) {
    if (fs.existsSync(options.adjudicationsPath)) {
      const adjContent = fs.readFileSync(options.adjudicationsPath, "utf-8");
      adjudications = JSON.parse(adjContent);
    } else {
      console.warn(
        `Adjudications file not found: ${options.adjudicationsPath}`,
      );
    }
  }

  const report = runEvaluation(input, {
    datasetRegistry: defaultDatasetRegistry,
    adjudications,
  });

  let regressionReport;
  if (options.baselinePath) {
    if (fs.existsSync(options.baselinePath)) {
      const baselineJson = fs.readFileSync(options.baselinePath, "utf-8");
      const baselineReport = JSON.parse(baselineJson);
      regressionReport = compareRegressionReports(baselineReport, report);
    } else {
      console.warn(`Baseline file not found: ${options.baselinePath}`);
    }
  }

  const mdReport = generateMarkdownReport(report, regressionReport);
  const jsonReport = generateJsonReport(report, regressionReport);

  // Write outputs if requested
  if (options.outMdPath) {
    const dir = path.dirname(options.outMdPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(options.outMdPath, mdReport, "utf-8");
    console.log(`Markdown report written to: ${options.outMdPath}`);
  }

  if (options.outJsonPath) {
    const dir = path.dirname(options.outJsonPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(options.outJsonPath, jsonReport, "utf-8");
    console.log(`JSON report written to: ${options.outJsonPath}`);
  }

  // Print console summary
  console.log("--------------------------------------------------");
  console.log(`ReviewLens M5 Evaluation Run: ${report.manifest.runId}`);
  console.log(
    `Dataset: ${report.manifest.datasetId} (v${report.manifest.datasetVersion})`,
  );
  console.log(
    `Model: ${report.manifest.modelId} (${report.manifest.provider})`,
  );
  console.log("--------------------------------------------------");
  console.log(
    `Precision:            ${report.classification.precision !== null ? (report.classification.precision * 100).toFixed(1) + "%" : "N/A"}`,
  );
  console.log(
    `Recall:               ${report.classification.recall !== null ? (report.classification.recall * 100).toFixed(1) + "%" : "N/A"}`,
  );
  console.log(
    `F1 Score:             ${report.classification.f1 !== null ? report.classification.f1.toFixed(3) : "N/A"}`,
  );
  console.log(
    `False Positives/Case: ${report.classification.falsePositivesPerCase.toFixed(2)}`,
  );
  console.log(
    `Counts:               TP: ${report.classification.truePositiveCount} | FP: ${report.classification.falsePositiveCount} | FN: ${report.classification.falseNegativeCount} | Dup: ${report.classification.duplicateCount} | Awaiting Review: ${report.classification.unadjudicatedCount}`,
  );
  console.log("--------------------------------------------------");
}

// Execute CLI if run directly
const isDirectExecution =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  runCli();
}
