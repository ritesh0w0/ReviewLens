import type { PinnedModelId } from "../config.js";
import { classifyAIError } from "../reliability/errors.js";
import type {
  AIChunkReviewRequest,
  AIChunkReviewResult,
  ReviewModel,
} from "../types.js";
import {
  parseAndValidateAIResponse,
  STRUCTURED_OUTPUT_JSON_SCHEMA,
} from "../validation/structured-output-schema.js";
import { buildChunkPrompt, SYSTEM_INSTRUCTION } from "./prompt-builder.js";

export class GroqProvider implements ReviewModel {
  readonly provider = "groq";

  constructor(
    readonly modelId: PinnedModelId,
    private readonly apiKey: string,
  ) {}

  async invokeChunkReview(
    request: AIChunkReviewRequest,
    signal?: AbortSignal,
  ): Promise<AIChunkReviewResult> {
    const startTime = Date.now();

    if (signal?.aborted) {
      return {
        status: "timeout",
        rawFindings: [],
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        errorCategory: "TIMEOUT",
        errorMessage: "Request aborted by caller signal",
      };
    }

    try {
      const { Groq } = await import("groq-sdk");
      const groq = new Groq({ apiKey: this.apiKey });

      const promptText = buildChunkPrompt(request);

      const completion = await groq.chat.completions.create(
        {
          model: this.modelId,
          messages: [
            {
              role: "system",
              content: `${SYSTEM_INSTRUCTION}\nReturn JSON format: { "findings": [ ... ] }`,
            },
            {
              role: "user",
              content: promptText,
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "reviewlens_findings_response",
              strict: true,
              schema: STRUCTURED_OUTPUT_JSON_SCHEMA,
            },
          },
          temperature: 0.1,
        },
        { signal },
      );

      const latencyMs = Date.now() - startTime;
      const content = completion.choices[0]?.message?.content ?? "";

      const inputTokens = completion.usage?.prompt_tokens ?? 0;
      const outputTokens = completion.usage?.completion_tokens ?? 0;

      const parsed = parseAndValidateAIResponse(content);
      if (!parsed.success) {
        return {
          status: "error",
          rawFindings: [],
          inputTokens,
          outputTokens,
          latencyMs,
          errorCategory: "BAD_REQUEST",
          errorMessage: parsed.error,
        };
      }

      return {
        status: "success",
        rawFindings: parsed.findings,
        inputTokens,
        outputTokens,
        latencyMs,
      };
    } catch (err: unknown) {
      const latencyMs = Date.now() - startTime;
      const classified = classifyAIError(err);

      return {
        status:
          classified.category === "RATE_LIMIT_RPM" ||
          classified.category === "RATE_LIMIT_RPD"
            ? "rate_limited"
            : classified.category === "TIMEOUT"
              ? "timeout"
              : classified.category === "SAFETY_REFUSAL"
                ? "refusal"
                : "error",
        rawFindings: [],
        inputTokens: 0,
        outputTokens: 0,
        latencyMs,
        errorCategory: classified.category,
        errorMessage: classified.message,
      };
    }
  }
}
