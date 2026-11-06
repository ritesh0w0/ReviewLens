import {
  BenchmarkDatasetSchema,
  type BenchmarkDataset,
  type EvaluationCase,
} from "./schema.js";
import { BENCHMARK_DATASET_V1 } from "./v1/index.js";

export class DatasetValidationError extends Error {
  readonly code = "DATASET_VALIDATION_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "DatasetValidationError";
  }
}

export function validateBenchmarkDataset(data: unknown): BenchmarkDataset {
  const result = BenchmarkDatasetSchema.safeParse(data);
  if (!result.success) {
    const errorDetails = result.error.issues
      .map((i) => `[${i.path.join(".") || "root"}]: ${i.message}`)
      .join("; ");
    throw new DatasetValidationError(
      `Invalid benchmark dataset: ${errorDetails}`,
    );
  }
  return result.data;
}

export class DatasetRegistry {
  private readonly datasets = new Map<string, BenchmarkDataset>();

  constructor() {
    this.register(BENCHMARK_DATASET_V1);
  }

  register(dataset: BenchmarkDataset): void {
    const validated = validateBenchmarkDataset(dataset);
    const key = `${validated.datasetId}@${validated.version}`;
    this.datasets.set(key, validated);
    // Also index by datasetId for latest version lookup
    this.datasets.set(validated.datasetId, validated);
  }

  get(datasetId: string, version?: string): BenchmarkDataset | undefined {
    if (version) {
      return this.datasets.get(`${datasetId}@${version}`);
    }
    return this.datasets.get(datasetId);
  }

  getCase(
    datasetId: string,
    caseId: string,
    version?: string,
  ): EvaluationCase | undefined {
    const dataset = this.get(datasetId, version);
    if (!dataset) return undefined;
    return dataset.cases.find((c) => c.caseId === caseId);
  }

  list(): readonly {
    datasetId: string;
    version: string;
    casesCount: number;
  }[] {
    const result: { datasetId: string; version: string; casesCount: number }[] =
      [];
    const seen = new Set<string>();
    for (const ds of this.datasets.values()) {
      const key = `${ds.datasetId}@${ds.version}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push({
          datasetId: ds.datasetId,
          version: ds.version,
          casesCount: ds.cases.length,
        });
      }
    }
    return result;
  }

  getDefault(): BenchmarkDataset {
    return BENCHMARK_DATASET_V1;
  }
}

export const defaultDatasetRegistry = new DatasetRegistry();
