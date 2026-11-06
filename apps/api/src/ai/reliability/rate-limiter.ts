import {
  RATE_CEILINGS,
  type PinnedModelId,
  type RateCeiling,
} from "../config.js";

interface WindowUsage {
  requestTimestamps: number[];
  tokenCounts: { timestamp: number; tokens: number }[];
  dailyRequests: number;
  dailyTokens: number;
  dailyResetTimestamp: number;
}

export interface ReservationResult {
  readonly allowed: boolean;
  readonly waitMs?: number;
  readonly reason?: string;
}

export class ModelRateLimiter {
  private readonly usage = new Map<PinnedModelId, WindowUsage>();

  constructor(
    private readonly customCeilings?: Partial<
      Record<PinnedModelId, RateCeiling>
    >,
  ) {}

  private getUsage(modelId: PinnedModelId): WindowUsage {
    let u = this.usage.get(modelId);
    if (!u) {
      u = {
        requestTimestamps: [],
        tokenCounts: [],
        dailyRequests: 0,
        dailyTokens: 0,
        dailyResetTimestamp: Date.now() + 24 * 60 * 60 * 1000,
      };
      this.usage.set(modelId, u);
    }
    return u;
  }

  private pruneOldEntries(u: WindowUsage, now: number): void {
    const oneMinuteAgo = now - 60000;
    u.requestTimestamps = u.requestTimestamps.filter((t) => t > oneMinuteAgo);
    u.tokenCounts = u.tokenCounts.filter((t) => t.timestamp > oneMinuteAgo);

    if (now >= u.dailyResetTimestamp) {
      u.dailyRequests = 0;
      u.dailyTokens = 0;
      u.dailyResetTimestamp = now + 24 * 60 * 60 * 1000;
    }
  }

  getCeiling(modelId: PinnedModelId): RateCeiling {
    return this.customCeilings?.[modelId] ?? RATE_CEILINGS[modelId];
  }

  reserve(modelId: PinnedModelId, estimatedTokens: number): ReservationResult {
    const ceiling = this.getCeiling(modelId);
    if (!ceiling) {
      return { allowed: true };
    }

    const now = Date.now();
    const u = this.getUsage(modelId);
    this.pruneOldEntries(u, now);

    // 1. Check daily requests limit
    if (ceiling.maxRpd && u.dailyRequests >= ceiling.maxRpd) {
      return {
        allowed: false,
        reason: `Daily request quota (${ceiling.maxRpd} RPD) reached for ${modelId}`,
      };
    }

    // 2. Check daily tokens limit
    if (ceiling.maxTpd && u.dailyTokens + estimatedTokens > ceiling.maxTpd) {
      return {
        allowed: false,
        reason: `Daily token quota (${ceiling.maxTpd} TPD) reached for ${modelId}`,
      };
    }

    // 3. Check RPM
    if (u.requestTimestamps.length >= ceiling.maxRpm) {
      const oldest = u.requestTimestamps[0]!;
      const waitMs = Math.max(100, oldest + 60000 - now);
      return {
        allowed: false,
        waitMs,
        reason: `RPM ceiling (${ceiling.maxRpm} RPM) reached for ${modelId}`,
      };
    }

    // 4. Check TPM
    const currentTpm = u.tokenCounts.reduce((acc, c) => acc + c.tokens, 0);
    if (currentTpm + estimatedTokens > ceiling.maxTpm) {
      const oldestToken = u.tokenCounts[0]?.timestamp ?? now;
      const waitMs = Math.max(100, oldestToken + 60000 - now);
      return {
        allowed: false,
        waitMs,
        reason: `TPM ceiling (${ceiling.maxTpm} TPM) reached for ${modelId}`,
      };
    }

    // Reserve spot
    u.requestTimestamps.push(now);
    u.tokenCounts.push({ timestamp: now, tokens: estimatedTokens });
    u.dailyRequests++;
    u.dailyTokens += estimatedTokens;

    return { allowed: true };
  }

  recordUsage(
    modelId: PinnedModelId,
    actualInputTokens: number,
    actualOutputTokens: number,
  ): void {
    const u = this.getUsage(modelId);
    const totalActual = actualInputTokens + actualOutputTokens;
    u.dailyTokens += totalActual;
  }

  reset(): void {
    this.usage.clear();
  }
}

export const globalRateLimiter = new ModelRateLimiter();
