import { z } from "zod";

// Pinned Model Identifiers (strictly non-floating)
export const PINNED_MODELS = {
  GEMINI_3_5_FLASH_LITE: "gemini-3.5-flash-lite",
  GEMINI_3_6_FLASH: "gemini-3.6-flash",
  GROQ_GPT_OSS_120B: "openai/gpt-oss-120b",
} as const;

export type PinnedModelId = (typeof PINNED_MODELS)[keyof typeof PINNED_MODELS];

export const AI_PROFILES = {
  standard: [
    PINNED_MODELS.GEMINI_3_5_FLASH_LITE,
    PINNED_MODELS.GEMINI_3_6_FLASH,
    PINNED_MODELS.GROQ_GPT_OSS_120B,
  ],
  development: [
    PINNED_MODELS.GEMINI_3_5_FLASH_LITE,
    PINNED_MODELS.GEMINI_3_6_FLASH,
    PINNED_MODELS.GROQ_GPT_OSS_120B,
  ],
  demo: [
    PINNED_MODELS.GEMINI_3_5_FLASH_LITE,
    PINNED_MODELS.GEMINI_3_6_FLASH,
    PINNED_MODELS.GROQ_GPT_OSS_120B,
  ],
  production: [
    PINNED_MODELS.GEMINI_3_5_FLASH_LITE,
    PINNED_MODELS.GEMINI_3_6_FLASH,
    PINNED_MODELS.GROQ_GPT_OSS_120B,
  ],
} as const;

export type AIProfileName = keyof typeof AI_PROFILES;

// Operating token budgets per provider family
export interface ModelOperatingBudget {
  readonly targetInputTokens: number;
  readonly hardCapInputTokens: number;
  readonly maxOutputReserveTokens: number;
}

export const MODEL_OPERATING_BUDGETS: Record<
  PinnedModelId,
  ModelOperatingBudget
> = {
  [PINNED_MODELS.GEMINI_3_5_FLASH_LITE]: {
    targetInputTokens: 16000,
    hardCapInputTokens: 20000,
    maxOutputReserveTokens: 1536,
  },
  [PINNED_MODELS.GEMINI_3_6_FLASH]: {
    targetInputTokens: 16000,
    hardCapInputTokens: 20000,
    maxOutputReserveTokens: 1536,
  },
  [PINNED_MODELS.GROQ_GPT_OSS_120B]: {
    targetInputTokens: 3000,
    hardCapInputTokens: 3500,
    maxOutputReserveTokens: 1024,
  },
};

// Conservative rate ceilings (80% operating margin on free-tier limits)
export interface RateCeiling {
  readonly maxRpm: number;
  readonly maxTpm: number;
  readonly maxRpd: number;
  readonly maxTpd?: number;
}

export const RATE_CEILINGS: Record<PinnedModelId, RateCeiling> = {
  [PINNED_MODELS.GEMINI_3_5_FLASH_LITE]: {
    maxRpm: 12,
    maxTpm: 200000,
    maxRpd: 400,
  },
  [PINNED_MODELS.GEMINI_3_6_FLASH]: {
    maxRpm: 4,
    maxTpm: 200000,
    maxRpd: 16,
  },
  [PINNED_MODELS.GROQ_GPT_OSS_120B]: {
    maxRpm: 24,
    maxTpm: 6400,
    maxRpd: 800,
    maxTpd: 160000,
  },
};

// Context and chunking limits
export const CONTEXT_LIMITS = {
  MAX_SINGLE_FILE_BYTES: 256 * 1024, // 256 KiB
  MAX_AGGREGATE_SOURCE_BYTES: 2 * 1024 * 1024, // 2 MiB
  MAX_CONTEXT_FILES_PER_PR: 30,
  CONTEXT_WINDOW_LINES: 30, // ±30 lines around relevant hunks
  MAX_FILES_PER_UNIT: 3,
  MAX_REQUEST_CHUNKS_PER_RUN: 8,
  MAX_FINDINGS_PER_CHUNK: 5,
} as const;

// Environment schema
const envSchema = z.object({
  REVIEWLENS_AI_ENABLED: z
    .string()
    .optional()
    .default("false")
    .transform((val) => val === "true" || val === "1"),
  REVIEWLENS_AI_KILL_SWITCH: z
    .string()
    .optional()
    .default("false")
    .transform((val) => val === "true" || val === "1"),
  REVIEWLENS_AI_PROFILE: z
    .enum(["standard", "development", "demo", "production"])
    .optional()
    .default("development"),
  GEMINI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
});

export interface AIConfig {
  readonly enabled: boolean;
  readonly killSwitch: boolean;
  readonly profile: AIProfileName;
  readonly geminiApiKey?: string;
  readonly groqApiKey?: string;
}

export function loadAIConfig(env: NodeJS.ProcessEnv = process.env): AIConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    return {
      enabled: false,
      killSwitch: false,
      profile: "development",
    };
  }

  return {
    enabled: parsed.data.REVIEWLENS_AI_ENABLED,
    killSwitch: parsed.data.REVIEWLENS_AI_KILL_SWITCH,
    profile: parsed.data.REVIEWLENS_AI_PROFILE,
    geminiApiKey: parsed.data.GEMINI_API_KEY?.trim() || undefined,
    groqApiKey: parsed.data.GROQ_API_KEY?.trim() || undefined,
  };
}
