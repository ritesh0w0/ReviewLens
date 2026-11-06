import { z } from "zod";
import type { RawAICandidate } from "../types.js";

export const RawAICandidateSchema = z.object({
  file_path: z.string().min(1).max(500),
  line: z.number().int().min(1),
  side: z.enum(["LEFT", "RIGHT"]),
  category: z.enum([
    "correctness",
    "security",
    "reliability",
    "performance",
    "resource_usage",
  ]),
  severity: z.enum(["critical", "high", "medium", "low", "info"]),
  confidence: z.number().min(0.0).max(1.0),
  title: z.string().min(1).max(120),
  message: z.string().min(1).max(2000),
  evidence_quote: z.string().min(1).max(500),
});

export const AIStructuredOutputSchema = z.object({
  findings: z.array(RawAICandidateSchema).max(5),
});

export type AIStructuredOutput = z.infer<typeof AIStructuredOutputSchema>;

export const STRUCTURED_OUTPUT_JSON_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "The repository-relative path of the affected file.",
          },
          line: {
            type: "integer",
            minimum: 1,
            description:
              "The 1-based target line number in the diff (RIGHT side for added/modified, LEFT for deleted).",
          },
          side: {
            type: "string",
            enum: ["LEFT", "RIGHT"],
            description:
              "RIGHT for lines added or modified in the pull request, LEFT for lines deleted.",
          },
          category: {
            type: "string",
            enum: [
              "correctness",
              "security",
              "reliability",
              "performance",
              "resource_usage",
            ],
            description: "The primary domain of the finding.",
          },
          severity: {
            type: "string",
            enum: ["critical", "high", "medium", "low", "info"],
            description: "The severity of the issue.",
          },
          confidence: {
            type: "number",
            minimum: 0.0,
            maximum: 1.0,
            description:
              "Confidence score between 0.0 and 1.0 reflecting certainty of this finding.",
          },
          title: {
            type: "string",
            maxLength: 120,
            description: "A concise single-sentence summary of the defect.",
          },
          message: {
            type: "string",
            maxLength: 2000,
            description:
              "Clear, advisory technical explanation in Markdown. Plain guidance only; do not include raw secrets or HTML.",
          },
          evidence_quote: {
            type: "string",
            maxLength: 500,
            description:
              "The exact verbatim line or short snippet from the code at the target line.",
          },
        },
        required: [
          "file_path",
          "line",
          "side",
          "category",
          "severity",
          "confidence",
          "title",
          "message",
          "evidence_quote",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["findings"],
  additionalProperties: false,
} as const;

export function parseAndValidateAIResponse(
  jsonText: string,
):
  | { success: true; findings: RawAICandidate[] }
  | { success: false; error: string } {
  try {
    const raw = JSON.parse(jsonText);
    const parsed = AIStructuredOutputSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error: `Schema validation failed: ${parsed.error.message}`,
      };
    }
    return {
      success: true,
      findings: parsed.data.findings,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: `JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
