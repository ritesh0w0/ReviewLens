import type { PinnedModelId } from "../config.js";
import type {
  AIChunkReviewRequest,
  AIChunkReviewResult,
  ReviewModel,
} from "../types.js";

export class NullModel implements ReviewModel {
  readonly provider = "null";
  constructor(
    readonly modelId: PinnedModelId = "gemini-3.5-flash-lite" as PinnedModelId,
    private readonly reason: string = "AI analysis is disabled or unavailable",
  ) {}

  async invokeChunkReview(
    _request: AIChunkReviewRequest,
    _signal?: AbortSignal,
  ): Promise<AIChunkReviewResult> {
    void _request;
    void _signal;
    return {
      status: "error",
      rawFindings: [],
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      errorCategory: "UNAVAILABLE",
      errorMessage: this.reason,
    };
  }
}
