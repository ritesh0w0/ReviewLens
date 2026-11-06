import * as crypto from "node:crypto";
import type { ValidatedFinding } from "@reviewlens/core";
import { defaultDatasetRegistry, DatasetRegistry } from "../dataset/loader.js";
import type { BenchmarkDataset } from "../dataset/schema.js";
import {
  AdjudicationStore,
  type AdjudicationRecord,
} from "../matching/adjudication.js";
import {
  evaluateCaseFindings,
  type CaseMatchResult,
} from "../matching/matcher.js";
import {
  computeClassificationMetrics,
  type ClassificationMetrics,
} from "../metrics/classification.js";
import {
  computeLocalizationMetrics,
  type LocalizationMetrics,
} from "../metrics/localization.js";
import {
  computeCalibrationMetrics,
  type CalibrationMetrics,
} from "../metrics/calibration.js";
import type { EvaluationRunInput } from "./input-schema.js";

export interface EvaluationExecutionSummary {
  readonly totalCases: number;
  readonly completedCases: number;
  readonly failedCases: number;
  readonly totalLatencyMs: number;
  readonly meanLatencyMs: number;
  readonly totalTokensIn: number;
  readonly totalTokensOut: number;
  readonly totalCandidatesGenerated: number;
  readonly totalCandidatesValidated: number;
  readonly evidenceValidationPassRate: number | null;
  readonly fallbackCount: number;
}

export interface EvaluationReport {
  readonly manifest: {
    readonly runId: string;
    readonly datasetId: string;
    readonly datasetVersion: string;
    readonly datasetChecksum: string;
    readonly evaluator: string;
    readonly timestamp: string;
    readonly provider: string;
    readonly modelId: string;
    readonly promptVersion: string;
    readonly schemaVersion: string;
  };
  readonly executionSummary: EvaluationExecutionSummary;
  readonly classification: ClassificationMetrics;
  readonly localization: LocalizationMetrics;
  readonly calibration: CalibrationMetrics;
  readonly caseResults: readonly CaseMatchResult[];
}

export interface EvaluationRunnerOptions {
  datasetRegistry?: DatasetRegistry;
  adjudications?: readonly AdjudicationRecord[];
}

export function runEvaluation(
  input: EvaluationRunInput,
  options?: EvaluationRunnerOptions,
): EvaluationReport {
  const registry = options?.datasetRegistry ?? defaultDatasetRegistry;
  const dataset: BenchmarkDataset | undefined = registry.get(
    input.datasetId,
    input.datasetVersion,
  );

  if (!dataset) {
    throw new Error(
      `Dataset '${input.datasetId}' version '${input.datasetVersion}' not found in registry`,
    );
  }

  const adjudicationStore = new AdjudicationStore(options?.adjudications ?? []);
  const caseResults: CaseMatchResult[] = [];

  let completedCases = 0;
  let failedCases = 0;
  let totalLatencyMs = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let totalGenerated = 0;
  let totalValidated = 0;
  let totalEvidencePassed = 0;
  let totalEvidenceRejected = 0;
  let fallbackCount = 0;

  for (const evalCase of dataset.cases) {
    const caseRun = input.caseResults.find(
      (cr) => cr.caseId === evalCase.caseId,
    );

    if (!caseRun) {
      // Case was omitted or missing from run input
      failedCases++;
      caseResults.push({
        caseId: evalCase.caseId,
        truePositives: [],
        falsePositives: [],
        falseNegatives: evalCase.expectedFindings,
        duplicates: [],
        unadjudicated: [],
        allCandidateMappings: [],
      });
      continue;
    }

    if (
      caseRun.executionStatus === "COMPLETE" ||
      caseRun.executionStatus === "NOT_NEEDED"
    ) {
      completedCases++;
    } else {
      failedCases++;
    }

    totalLatencyMs += caseRun.latencyMs;
    totalTokensIn += caseRun.tokensIn;
    totalTokensOut += caseRun.tokensOut;
    totalGenerated += caseRun.candidatesGenerated;
    totalValidated += caseRun.candidatesValidated;
    totalEvidencePassed += caseRun.evidencePassed;
    totalEvidenceRejected += caseRun.evidenceRejected;
    if (caseRun.fallbackOccurred) fallbackCount++;

    const findings = (caseRun.acceptedFindings ?? []) as ValidatedFinding[];
    const matchResult = evaluateCaseFindings(
      evalCase,
      findings,
      adjudicationStore,
    );
    caseResults.push(matchResult);
  }

  const classification = computeClassificationMetrics(caseResults);
  const localization = computeLocalizationMetrics(caseResults);

  const allMappings = caseResults.flatMap((r) => r.allCandidateMappings);
  const calibration = computeCalibrationMetrics(allMappings);

  const meanLatencyMs =
    dataset.cases.length > 0 ? totalLatencyMs / dataset.cases.length : 0;

  const totalEvidenceEvaluated = totalEvidencePassed + totalEvidenceRejected;
  const evidenceValidationPassRate =
    totalEvidenceEvaluated > 0
      ? totalEvidencePassed / totalEvidenceEvaluated
      : null;

  const executionSummary: EvaluationExecutionSummary = {
    totalCases: dataset.cases.length,
    completedCases,
    failedCases,
    totalLatencyMs,
    meanLatencyMs,
    totalTokensIn,
    totalTokensOut,
    totalCandidatesGenerated: totalGenerated,
    totalCandidatesValidated: totalValidated,
    evidenceValidationPassRate,
    fallbackCount,
  };

  const datasetChecksum = crypto
    .createHash("sha256")
    .update(JSON.stringify(dataset))
    .digest("hex");

  return {
    manifest: {
      runId: input.runId,
      datasetId: input.datasetId,
      datasetVersion: input.datasetVersion,
      datasetChecksum,
      evaluator: input.evaluator,
      timestamp: input.timestamp,
      provider: input.provider,
      modelId: input.modelId,
      promptVersion: input.promptVersion,
      schemaVersion: input.schemaVersion,
    },
    executionSummary,
    classification,
    localization,
    calibration,
    caseResults,
  };
}
