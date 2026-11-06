import { z } from "zod";

export const GroundTruthStatusSchema = z.enum(["DRAFT", "OWNER_REVIEWED"]);
export type GroundTruthStatus = z.infer<typeof GroundTruthStatusSchema>;

export const FindingCategorySchema = z.enum([
  "correctness",
  "security",
  "reliability",
  "performance",
  "resource_usage",
]);
export type FindingCategory = z.infer<typeof FindingCategorySchema>;

export const FindingSeveritySchema = z.enum([
  "critical",
  "high",
  "medium",
  "low",
  "info",
]);
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;

export const LineRangeSchema = z
  .object({
    start: z.number().int().min(1),
    end: z.number().int().min(1),
  })
  .refine((val) => val.end >= val.start, {
    message: "Line range end must be greater than or equal to start",
  });
export type LineRange = z.infer<typeof LineRangeSchema>;

export const ExpectedFindingSchema = z.object({
  issueId: z
    .string()
    .min(1)
    .regex(
      /^CASE-\d{2}-ISSUE-\d+$/,
      "Expected issueId format: CASE-XX-ISSUE-Y",
    ),
  category: FindingCategorySchema,
  severity: FindingSeveritySchema,
  targetPath: z.string().min(1),
  targetSide: z.enum(["LEFT", "RIGHT"]),
  lineRange: LineRangeSchema,
  description: z.string().min(5).max(500),
  rootCause: z.string().min(5).max(500),
  actionability: z.string().min(5).max(500),
  labelStatus: GroundTruthStatusSchema.default("DRAFT"),
});
export type ExpectedFinding = z.infer<typeof ExpectedFindingSchema>;

export const FixtureFileSchema = z.object({
  path: z.string().min(1),
  oldPath: z.string().optional(),
  patch: z.string().min(1),
  baseContent: z.string().optional(),
  headContent: z.string().optional(),
});
export type FixtureFile = z.infer<typeof FixtureFileSchema>;

export const EvaluationCasePurposeSchema = z.enum([
  "correctness_detection",
  "security_reasoning",
  "reliability_reasoning",
  "deletion_reasoning",
  "false_positive_resistance",
  "adversarial_robustness",
]);
export type EvaluationCasePurpose = z.infer<typeof EvaluationCasePurposeSchema>;

export const EvaluationCaseSchema = z.object({
  caseId: z
    .string()
    .regex(/^CASE-\d{2}$/, "Expected caseId format: CASE-XX (e.g. CASE-01)"),
  title: z.string().min(3).max(100),
  description: z.string().min(10).max(1000),
  language: z.enum(["typescript", "javascript"]),
  purpose: EvaluationCasePurposeSchema,
  baseSha: z
    .string()
    .length(40, "baseSha must be a 40-character hex commit SHA"),
  headSha: z
    .string()
    .length(40, "headSha must be a 40-character hex commit SHA"),
  files: z
    .array(FixtureFileSchema)
    .min(1, "Case must contain at least one file fixture"),
  expectedFindings: z.array(ExpectedFindingSchema),
  labelStatus: GroundTruthStatusSchema.default("DRAFT"),
});
export type EvaluationCase = z.infer<typeof EvaluationCaseSchema>;

export const BenchmarkDatasetSchema = z
  .object({
    datasetId: z.string().min(1),
    version: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/, "Version must be semver (X.Y.Z)"),
    description: z.string().min(10),
    createdAt: z.string().datetime(),
    cases: z.array(EvaluationCaseSchema).min(1),
  })
  .refine(
    (ds) => {
      const caseIds = new Set<string>();
      for (const c of ds.cases) {
        if (caseIds.has(c.caseId)) return false;
        caseIds.add(c.caseId);
      }
      return true;
    },
    { message: "Dataset contains duplicate case IDs" },
  )
  .refine(
    (ds) => {
      const issueIds = new Set<string>();
      for (const c of ds.cases) {
        for (const ef of c.expectedFindings) {
          if (issueIds.has(ef.issueId)) return false;
          issueIds.add(ef.issueId);
        }
      }
      return true;
    },
    { message: "Dataset contains duplicate expected issue IDs across cases" },
  );
export type BenchmarkDataset = z.infer<typeof BenchmarkDatasetSchema>;
