import type { PinnedModelId } from "../config.js";
import type {
  AIChunkReviewRequest,
  AIChunkReviewResult,
  RawAICandidate,
  ReviewModel,
} from "../types.js";

export interface ReplayModelOptions {
  modelId?: PinnedModelId;
  cannedResponses?: (AIChunkReviewResult | Error)[];
  defaultFindings?: RawAICandidate[];
  latencyMs?: number;
}

export class ReplayModel implements ReviewModel {
  readonly modelId: PinnedModelId;
  readonly provider = "replay";
  private callCount = 0;
  private readonly cannedResponses: (AIChunkReviewResult | Error)[];
  private readonly defaultFindings: RawAICandidate[];
  private readonly latencyMs: number;
  public readonly recordedRequests: AIChunkReviewRequest[] = [];

  constructor(options?: ReplayModelOptions) {
    this.modelId =
      options?.modelId ?? ("gemini-3.5-flash-lite" as PinnedModelId);
    this.cannedResponses = options?.cannedResponses ?? [];
    this.defaultFindings = options?.defaultFindings ?? [];
    this.latencyMs = options?.latencyMs ?? 5;
  }

  async invokeChunkReview(
    request: AIChunkReviewRequest,
    signal?: AbortSignal,
  ): Promise<AIChunkReviewResult> {
    if (signal?.aborted) {
      return {
        status: "timeout",
        rawFindings: [],
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        errorMessage: "Aborted by signal",
      };
    }

    this.recordedRequests.push(request);
    const idx = this.callCount++;

    if (this.latencyMs > 0) {
      await new Promise((r) => setTimeout(r, this.latencyMs));
    }

    if (idx < this.cannedResponses.length) {
      const resp = this.cannedResponses[idx]!;
      if (resp instanceof Error) {
        throw resp;
      }
      return resp;
    }

    return {
      status: "success",
      rawFindings: this.defaultFindings,
      inputTokens: 250,
      outputTokens: 100,
      latencyMs: this.latencyMs,
    };
  }

  getCalls(): number {
    return this.callCount;
  }

  reset(): void {
    this.callCount = 0;
    this.recordedRequests.length = 0;
  }
}
