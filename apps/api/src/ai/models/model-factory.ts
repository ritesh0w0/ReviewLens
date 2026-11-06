import { PINNED_MODELS, type AIConfig, type PinnedModelId } from "../config.js";
import type { ReviewModel } from "../types.js";
import { GeminiProvider } from "./gemini-provider.js";
import { GroqProvider } from "./groq-provider.js";
import { ModelRouter } from "./model-router.js";
import { NullModel } from "./null-model.js";

export function createModelRouter(
  config: AIConfig,
  overrides?: {
    models?: Map<PinnedModelId, ReviewModel>;
  },
): ModelRouter {
  const models = new Map<PinnedModelId, ReviewModel>();

  if (overrides?.models) {
    for (const [id, model] of overrides.models.entries()) {
      models.set(id, model);
    }
  }

  // Populate any missing models
  if (!models.has(PINNED_MODELS.GEMINI_3_5_FLASH_LITE)) {
    if (config.geminiApiKey) {
      models.set(
        PINNED_MODELS.GEMINI_3_5_FLASH_LITE,
        new GeminiProvider(
          PINNED_MODELS.GEMINI_3_5_FLASH_LITE,
          config.geminiApiKey,
        ),
      );
    } else {
      models.set(
        PINNED_MODELS.GEMINI_3_5_FLASH_LITE,
        new NullModel(
          PINNED_MODELS.GEMINI_3_5_FLASH_LITE,
          "GEMINI_API_KEY is not configured",
        ),
      );
    }
  }

  if (!models.has(PINNED_MODELS.GEMINI_3_6_FLASH)) {
    if (config.geminiApiKey) {
      models.set(
        PINNED_MODELS.GEMINI_3_6_FLASH,
        new GeminiProvider(PINNED_MODELS.GEMINI_3_6_FLASH, config.geminiApiKey),
      );
    } else {
      models.set(
        PINNED_MODELS.GEMINI_3_6_FLASH,
        new NullModel(
          PINNED_MODELS.GEMINI_3_6_FLASH,
          "GEMINI_API_KEY is not configured",
        ),
      );
    }
  }

  if (!models.has(PINNED_MODELS.GROQ_GPT_OSS_120B)) {
    if (config.groqApiKey) {
      models.set(
        PINNED_MODELS.GROQ_GPT_OSS_120B,
        new GroqProvider(PINNED_MODELS.GROQ_GPT_OSS_120B, config.groqApiKey),
      );
    } else {
      models.set(
        PINNED_MODELS.GROQ_GPT_OSS_120B,
        new NullModel(
          PINNED_MODELS.GROQ_GPT_OSS_120B,
          "GROQ_API_KEY is not configured",
        ),
      );
    }
  }

  return new ModelRouter({
    profile: config.profile,
    models,
  });
}
