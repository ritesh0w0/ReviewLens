import { describe, it, expect } from "vitest";
import {
  BenchmarkDatasetSchema,
  EvaluationCaseSchema,
  ExpectedFindingSchema,
} from "../src/dataset/schema.js";
import { BENCHMARK_DATASET_V1 } from "../src/dataset/v1/index.js";
import {
  DatasetRegistry,
  defaultDatasetRegistry,
  validateBenchmarkDataset,
} from "../src/dataset/loader.js";

describe("Benchmark Dataset v1 Schema and Integrity", () => {
  it("validates that BENCHMARK_DATASET_V1 matches BenchmarkDatasetSchema", () => {
    const validated = validateBenchmarkDataset(BENCHMARK_DATASET_V1);
    expect(validated.datasetId).toBe("reviewlens-benchmark-v1");
    expect(validated.version).toBe("1.0.0");
    expect(validated.cases).toHaveLength(8);
  });

  it("ensures all 8 cases have valid schemas and required metadata", () => {
    for (const c of BENCHMARK_DATASET_V1.cases) {
      const validatedCase = EvaluationCaseSchema.parse(c);
      expect(validatedCase.caseId).toMatch(/^CASE-0[1-8]$/);
      expect(validatedCase.files.length).toBeGreaterThan(0);
      expect(validatedCase.labelStatus).toBe("DRAFT");
    }
  });

  it("ensures all expected findings have DRAFT status pending human review", () => {
    const allExpectedFindings = BENCHMARK_DATASET_V1.cases.flatMap(
      (c) => c.expectedFindings,
    );
    expect(allExpectedFindings.length).toBeGreaterThan(0);
    for (const ef of allExpectedFindings) {
      expect(ef.labelStatus).toBe("DRAFT");
      expect(ef.lineRange.start).toBeLessThanOrEqual(ef.lineRange.end);
      expect(ef.description.length).toBeGreaterThan(10);
      expect(ef.rootCause.length).toBeGreaterThan(10);
      expect(ef.actionability.length).toBeGreaterThan(10);
    }
  });

  it("verifies clean refactor cases (CASE-06, CASE-07) have zero expected issues", () => {
    const case06 = BENCHMARK_DATASET_V1.cases.find(
      (c) => c.caseId === "CASE-06",
    );
    const case07 = BENCHMARK_DATASET_V1.cases.find(
      (c) => c.caseId === "CASE-07",
    );
    expect(case06).toBeDefined();
    expect(case07).toBeDefined();
    expect(case06?.expectedFindings).toHaveLength(0);
    expect(case07?.expectedFindings).toHaveLength(0);
  });

  it("verifies adversarial injection case CASE-08 tests resilience alongside memory leak", () => {
    const case08 = BENCHMARK_DATASET_V1.cases.find(
      (c) => c.caseId === "CASE-08",
    );
    expect(case08).toBeDefined();
    expect(case08?.purpose).toBe("adversarial_robustness");
    expect(case08?.expectedFindings).toHaveLength(1);
    expect(case08?.expectedFindings[0].category).toBe("resource_usage");
  });

  it("verifies left-side deletion case CASE-05 targets deleted code on LEFT", () => {
    const case05 = BENCHMARK_DATASET_V1.cases.find(
      (c) => c.caseId === "CASE-05",
    );
    expect(case05).toBeDefined();
    expect(case05?.expectedFindings[0].targetSide).toBe("LEFT");
  });

  it("rejects dataset with duplicate case IDs", () => {
    const duplicateDataset = {
      ...BENCHMARK_DATASET_V1,
      cases: [BENCHMARK_DATASET_V1.cases[0], BENCHMARK_DATASET_V1.cases[0]],
    };
    expect(() => validateBenchmarkDataset(duplicateDataset)).toThrow(
      /duplicate case IDs/i,
    );
  });

  it("rejects invalid line range where end < start", () => {
    const invalidFinding = {
      issueId: "INVALID-1",
      category: "correctness",
      severity: "high",
      targetPath: "src/foo.ts",
      targetSide: "RIGHT",
      lineRange: { start: 20, end: 10 },
      description: "Invalid line range test finding",
      rootCause: "Testing end < start rejection",
      actionability: "Should fail validation",
      labelStatus: "DRAFT",
    };
    expect(() => ExpectedFindingSchema.parse(invalidFinding)).toThrow();
  });
});

describe("DatasetRegistry", () => {
  it("retrieves default dataset from defaultDatasetRegistry", () => {
    const ds = defaultDatasetRegistry.get("reviewlens-benchmark-v1", "1.0.0");
    expect(ds).toBeDefined();
    expect(ds?.cases.length).toBe(8);
  });

  it("returns latest version when version parameter is omitted", () => {
    const ds = defaultDatasetRegistry.get("reviewlens-benchmark-v1");
    expect(ds).toBeDefined();
    expect(ds?.version).toBe("1.0.0");
  });

  it("returns undefined for unknown dataset id or version", () => {
    expect(defaultDatasetRegistry.get("non-existent-id")).toBeUndefined();
    expect(
      defaultDatasetRegistry.get("reviewlens-benchmark-v1", "9.9.9"),
    ).toBeUndefined();
  });

  it("allows registering custom benchmark dataset", () => {
    const registry = new DatasetRegistry();
    const customDs = {
      ...BENCHMARK_DATASET_V1,
      datasetId: "custom-benchmark-v2",
      version: "2.0.0",
      cases: [BENCHMARK_DATASET_V1.cases[0]],
    };
    registry.register(customDs);
    expect(registry.get("custom-benchmark-v2", "2.0.0")).toBeDefined();
    expect(registry.list()).toContainEqual({
      datasetId: "custom-benchmark-v2",
      version: "2.0.0",
      casesCount: 1,
    });
  });
});
