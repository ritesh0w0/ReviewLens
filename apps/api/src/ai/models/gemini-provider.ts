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

export class GeminiProvider implements ReviewModel {
  readonly provider = "google";

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
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: this.apiKey });

      const promptText = buildChunkPrompt(request);

      const response = await ai.models.generateContent({
        model: this.modelId,
        contents: promptText,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseSchema: STRUCTURED_OUTPUT_JSON_SCHEMA,
          temperature: 0.1,
          abortSignal: signal,
        },
      });

      const latencyMs = Date.now() - startTime;
      const responseText = response.text ?? "";

      const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
      const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;

      const parsed = parseAndValidateAIResponse(responseText);
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
