import { z } from "zod";

export const CaseRunResultSchema = z.object({
  caseId: z.string().min(1),
  executionStatus: z.enum([
    "COMPLETE",
    "PARTIAL",
    "NOT_NEEDED",
    "NOT_ENABLED",
    "NOT_ELIGIBLE",
    "UNAVAILABLE",
    "FAILED",
    "CANCELLED",
  ]),
  acceptedFindings: z.array(z.any()), // ValidatedFinding structure validated at runtime
  candidatesGenerated: z.number().int().min(0).default(0),
  candidatesValidated: z.number().int().min(0).default(0),
  evidencePassed: z.number().int().min(0).default(0),
  evidenceRejected: z.number().int().min(0).default(0),
  latencyMs: z.number().int().min(0).default(0),
  tokensIn: z.number().int().min(0).default(0),
  tokensOut: z.number().int().min(0).default(0),
  fallbackOccurred: z.boolean().default(false),
});
export type CaseRunResult = z.infer<typeof CaseRunResultSchema>;

export const EvaluationRunInputSchema = z
  .object({
    runId: z.string().min(1),
    datasetId: z.string().min(1),
    datasetVersion: z.string().min(1),
    evaluator: z.string().min(1),
    timestamp: z.string().datetime(),
    provider: z.enum(["google", "groq", "replay", "deterministic"]),
    modelId: z.string().min(1),
    promptVersion: z.string().min(1),
    schemaVersion: z.string().min(1),
    caseResults: z.array(CaseRunResultSchema).min(1),
  })
  .refine(
    (input) => {
      // Disallow any fields containing sensitive keywords
      const serialized = JSON.stringify(input);
      return (
        !serialized.includes("apiKey") &&
        !serialized.includes("rawPrompt") &&
        !serialized.includes("client_secret")
      );
    },
    {
      message: "Evaluation run input must not contain raw secrets or API keys",
    },
  );
export type EvaluationRunInput = z.infer<typeof EvaluationRunInputSchema>;
