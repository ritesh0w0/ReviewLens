import * as fs from "node:fs";
import {
  EvaluationRunInputSchema,
  type EvaluationRunInput,
} from "./input-schema.js";

export class ResultLoadError extends Error {
  readonly code = "RESULT_LOAD_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "ResultLoadError";
  }
}

export function parseEvaluationRunInput(rawJson: string): EvaluationRunInput {
  try {
    const raw = JSON.parse(rawJson);
    const parsed = EvaluationRunInputSchema.safeParse(raw);
    if (!parsed.success) {
      const details = parsed.error.issues
        .map((i) => `[${i.path.join(".") || "root"}]: ${i.message}`)
        .join("; ");
      throw new ResultLoadError(`Invalid evaluation run input: ${details}`);
    }
    return parsed.data;
  } catch (err: unknown) {
    if (err instanceof ResultLoadError) throw err;
    throw new ResultLoadError(
      `Failed to parse evaluation run JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function loadEvaluationRunInputFromFile(
  filePath: string,
): EvaluationRunInput {
  if (!fs.existsSync(filePath)) {
    throw new ResultLoadError(`Evaluation input file not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, "utf-8");
  return parseEvaluationRunInput(content);
}
