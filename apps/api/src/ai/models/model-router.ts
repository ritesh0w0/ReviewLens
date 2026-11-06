import {
  AI_PROFILES,
  MODEL_OPERATING_BUDGETS,
  type AIProfileName,
  type PinnedModelId,
} from "../config.js";
import { CircuitBreaker } from "../reliability/circuit-breaker.js";
import {
  ModelRateLimiter,
  globalRateLimiter,
} from "../reliability/rate-limiter.js";
import type { ReviewModel } from "../types.js";

export interface ModelRouterOptions {
  profile: AIProfileName;
  models: Map<PinnedModelId, ReviewModel>;
  circuitBreakers?: Map<PinnedModelId, CircuitBreaker>;
  rateLimiter?: ModelRateLimiter;
}

export class ModelRouter {
  private readonly profile: AIProfileName;
  private readonly profileChain: readonly PinnedModelId[];
  private readonly models: Map<PinnedModelId, ReviewModel>;
  private readonly circuitBreakers: Map<PinnedModelId, CircuitBreaker>;
  private readonly rateLimiter: ModelRateLimiter;
  private currentActiveIndex = 0;

  constructor(options: ModelRouterOptions) {
    this.profile = options.profile;
    this.profileChain = AI_PROFILES[options.profile];
    this.models = options.models;
    this.circuitBreakers = options.circuitBreakers ?? new Map();
    this.rateLimiter = options.rateLimiter ?? globalRateLimiter;

    // Ensure circuit breakers exist for each model in chain
    for (const modelId of this.profileChain) {
      if (!this.circuitBreakers.has(modelId)) {
        this.circuitBreakers.set(modelId, new CircuitBreaker());
      }
    }
  }

  getActiveModelId(): PinnedModelId {
    return this.profileChain[this.currentActiveIndex] ?? this.profileChain[0]!;
  }

  getActiveModel(): ReviewModel | undefined {
    const id = this.getActiveModelId();
    return this.models.get(id);
  }

  getCircuitBreaker(modelId: PinnedModelId): CircuitBreaker {
    let cb = this.circuitBreakers.get(modelId);
    if (!cb) {
      cb = new CircuitBreaker();
      this.circuitBreakers.set(modelId, cb);
    }
    return cb;
  }

  canUseModel(
    modelId: PinnedModelId,
    estimatedTokens: number,
  ): {
    usable: boolean;
    reason?: string;
  } {
    const cb = this.getCircuitBreaker(modelId);
    if (!cb.isCallPermitted()) {
      return {
        usable: false,
        reason: `Circuit breaker is ${cb.getState()} for ${modelId}`,
      };
    }

    const outputReservation =
      MODEL_OPERATING_BUDGETS[modelId]?.maxOutputReserveTokens ?? 1024;
    const totalTokensToReserve = estimatedTokens + outputReservation;

    const reservation = this.rateLimiter.reserve(modelId, totalTokensToReserve);
    if (!reservation.allowed) {
      return { usable: false, reason: reservation.reason };
    }

    return { usable: true };
  }

  recordSuccess(modelId: PinnedModelId): void {
    const cb = this.getCircuitBreaker(modelId);
    cb.recordSuccess();
  }

  recordFailure(modelId: PinnedModelId): void {
    const cb = this.getCircuitBreaker(modelId);
    cb.recordFailure();
  }

  /**
   * Switches to the next available fallback model in the profile chain (sticky).
   */
  fallback(): { switched: boolean; newModelId?: PinnedModelId } {
    if (this.currentActiveIndex < this.profileChain.length - 1) {
      this.currentActiveIndex++;
      const newModelId = this.getActiveModelId();
      return { switched: true, newModelId };
    }
    return { switched: false };
  }

  resetFallback(): void {
    this.currentActiveIndex = 0;
  }
}
