import type { PinnedModelId } from "./config.js";

export type AIExecutionStatus =
  | "NOT_ENABLED"
  | "NOT_ELIGIBLE"
  | "NOT_NEEDED"
  | "RUNNING"
  | "COMPLETE"
  | "PARTIAL"
  | "UNAVAILABLE"
  | "FAILED"
  | "CANCELLED";

export type AIModelProvider = "google" | "groq" | "replay" | "null";

export type AICandidateCategory =
  "correctness" | "security" | "reliability" | "performance" | "resource_usage";

export type AICandidateSeverity =
  "critical" | "high" | "medium" | "low" | "info";

export interface RawAICandidate {
  file_path: string;
  line: number;
  side: "LEFT" | "RIGHT";
  category: AICandidateCategory;
  severity: AICandidateSeverity;
  confidence: number;
  title: string;
  message: string;
  evidence_quote: string;
}

export interface ReviewUnitFile {
  readonly path: string;
  readonly oldPath?: string;
  readonly patch: string;
  readonly boundedContent?: string;
  readonly commentableLines: readonly {
    line: number;
    side: "LEFT" | "RIGHT";
    hunkIndex: number;
  }[];
  readonly sanitizedLines?: readonly {
    line: number;
    side: "LEFT" | "RIGHT";
    content: string;
  }[];
}

export interface AIReviewUnit {
  readonly id: string;
  readonly files: readonly ReviewUnitFile[];
  readonly estimatedTokens: number;
}

export interface AIChunkReviewRequest {
  readonly chunkIndex: number;
  readonly totalChunks: number;
  readonly modelId: PinnedModelId;
  readonly files: readonly ReviewUnitFile[];
  readonly repositoryFullName: string;
  readonly prNumber: number;
  readonly headSha: string;
  readonly baseSha: string;
}

export type AIChunkCompletionStatus =
  "success" | "rate_limited" | "timeout" | "error" | "refusal";

export interface AIChunkReviewResult {
  readonly status: AIChunkCompletionStatus;
  readonly rawFindings: readonly RawAICandidate[];
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
  readonly errorCategory?: string;
  readonly errorMessage?: string;
}

export interface ReviewModel {
  readonly modelId: PinnedModelId;
  readonly provider: AIModelProvider;
  invokeChunkReview(
    request: AIChunkReviewRequest,
    signal?: AbortSignal,
  ): Promise<AIChunkReviewResult>;
}

export interface AIExecutionSummary {
  readonly status: AIExecutionStatus;
  readonly primaryModel: PinnedModelId;
  readonly finalModel?: PinnedModelId;
  readonly totalChunks: number;
  readonly completedChunks: number;
  readonly failedChunks: number;
  readonly skippedChunks: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly candidatesGenerated: number;
  readonly candidatesValidated: number;
  readonly failureReason?: string;
}
