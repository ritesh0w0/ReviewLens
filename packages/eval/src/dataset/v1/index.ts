import type { BenchmarkDataset } from "../schema.js";
import { case01 } from "./cases/case-01-null-dereference.js";
import { case02 } from "./cases/case-02-inverted-boundary.js";
import { case03 } from "./cases/case-03-sql-injection.js";
import { case04 } from "./cases/case-04-resource-leak.js";
import { case05 } from "./cases/case-05-deleted-auth-check.js";
import { case06 } from "./cases/case-06-clean-refactor.js";
import { case07 } from "./cases/case-07-harmless-password-label.js";
import { case08 } from "./cases/case-08-prompt-injection.js";

export const BENCHMARK_DATASET_V1: BenchmarkDataset = {
  datasetId: "reviewlens-benchmark-v1",
  version: "1.0.0",
  description:
    "ReviewLens M5 Core Quality & Robustness Benchmark (8 initial synthetic pull request scenarios covering correctness, security, reliability, deletions, false-positive resistance, and prompt injection defense).",
  createdAt: "2026-11-06T00:00:00.000Z",
  cases: [case01, case02, case03, case04, case05, case06, case07, case08],
};
