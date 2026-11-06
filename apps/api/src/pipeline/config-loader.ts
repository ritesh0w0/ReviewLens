import yaml from "yaml";
import { z } from "zod";
import picomatch from "picomatch";
import { RE2JS } from "re2js";
import type { GitHubPullRequestClient } from "../github/pull-request-client.js";
import type { EffectiveConfig, ReviewLensConfig } from "./types.js";

export const CONFIG_FILE_PATH = ".reviewlens.yml";
export const MAX_CONFIG_FILE_BYTES = 32 * 1024; // 32 KiB
export const MAX_PATTERNS_COUNT = 100;
export const MAX_PATTERN_LENGTH = 256;
export const MAX_RULE_COUNT = 50;
export const MAX_RULE_ID_LENGTH = 64;
export const MAX_REGEX_PATTERN_LENGTH = 512;
export const MAX_RULE_MESSAGE_LENGTH = 500;
export const MAX_SUFFIX_LENGTH = 64;

const singlePatternSchema = z
  .string()
  .min(1, "Pattern cannot be empty")
  .max(MAX_PATTERN_LENGTH, `Pattern exceeds ${MAX_PATTERN_LENGTH} characters`)
  .refine((p) => !p.startsWith("/"), "Absolute paths are not allowed")
  .refine(
    (p) => !p.includes(".."),
    "Path traversal segments (..) are not allowed",
  )
  .refine((p) => !p.includes("\0"), "NUL characters are not allowed")
  .refine((p) => !p.startsWith("!"), "Negated patterns (!) are not supported")
  .refine((p) => !p.includes("\\"), "Backslashes are not allowed in glob paths")
  .refine((p) => {
    try {
      picomatch(p);
      return true;
    } catch {
      return false;
    }
  }, "Pattern must be a valid glob expression");

export const findingSeveritySchema = z.enum([
  "critical",
  "high",
  "medium",
  "low",
  "info",
]);

export const forbidRegexConfigSchema = z
  .object({
    id: z
      .string()
      .min(1, "Rule ID cannot be empty")
      .max(
        MAX_RULE_ID_LENGTH,
        `Rule ID exceeds ${MAX_RULE_ID_LENGTH} characters`,
      ),
    type: z.literal("forbid_regex"),
    enabled: z.boolean(),
    pattern: z
      .string()
      .min(1, "Pattern cannot be empty")
      .max(
        MAX_REGEX_PATTERN_LENGTH,
        `Regex pattern exceeds ${MAX_REGEX_PATTERN_LENGTH} characters`,
      )
      .refine((p) => {
        try {
          RE2JS.compile(p);
          return true;
        } catch {
          return false;
        }
      }, "Pattern must be a valid RE2 regular expression"),
    case_sensitive: z.boolean().optional(),
    message: z
      .string()
      .min(1, "Message cannot be empty")
      .max(
        MAX_RULE_MESSAGE_LENGTH,
        `Message exceeds ${MAX_RULE_MESSAGE_LENGTH} characters`,
      ),
    severity: findingSeveritySchema.optional(),
  })
  .strict();

export const requireCompanionConfigSchema = z
  .object({
    id: z
      .string()
      .min(1, "Rule ID cannot be empty")
      .max(
        MAX_RULE_ID_LENGTH,
        `Rule ID exceeds ${MAX_RULE_ID_LENGTH} characters`,
      ),
    type: z.literal("require_companion"),
    enabled: z.boolean(),
    source_suffix: z
      .string()
      .min(1, "Source suffix cannot be empty")
      .max(
        MAX_SUFFIX_LENGTH,
        `Source suffix exceeds ${MAX_SUFFIX_LENGTH} characters`,
      ),
    companion_suffix: z
      .string()
      .min(1, "Companion suffix cannot be empty")
      .max(
        MAX_SUFFIX_LENGTH,
        `Companion suffix exceeds ${MAX_SUFFIX_LENGTH} characters`,
      ),
    severity: findingSeveritySchema.optional(),
  })
  .strict();

export const maxPrSizeConfigSchema = z
  .object({
    id: z
      .string()
      .min(1, "Rule ID cannot be empty")
      .max(
        MAX_RULE_ID_LENGTH,
        `Rule ID exceeds ${MAX_RULE_ID_LENGTH} characters`,
      ),
    type: z.literal("max_pr_size"),
    enabled: z.boolean(),
    max_files: z
      .number()
      .int()
      .positive("max_files must be a positive integer")
      .optional(),
    max_total_changes: z
      .number()
      .int()
      .positive("max_total_changes must be a positive integer")
      .optional(),
    severity: findingSeveritySchema.optional(),
  })
  .strict()
  .refine(
    (c) => c.max_files !== undefined || c.max_total_changes !== undefined,
    "At least one size threshold (max_files or max_total_changes) must be specified",
  );

export const singleRuleSchema = z.discriminatedUnion("type", [
  forbidRegexConfigSchema,
  requireCompanionConfigSchema,
  maxPrSizeConfigSchema,
]);

export const reviewSectionSchema = z
  .object({
    max_inline_comments: z
      .number()
      .int()
      .min(0, "max_inline_comments cannot be negative")
      .max(8, "max_inline_comments cannot exceed 8")
      .optional(),
  })
  .strict();

export const reviewLensConfigSchema = z
  .object({
    version: z.literal(1),
    paths: z
      .object({
        include: z
          .array(singlePatternSchema)
          .min(1, "Include list must contain at least 1 pattern when present")
          .max(
            MAX_PATTERNS_COUNT,
            `Include list exceeds ${MAX_PATTERNS_COUNT} patterns`,
          )
          .optional(),
        exclude: z
          .array(singlePatternSchema)
          .max(
            MAX_PATTERNS_COUNT,
            `Exclude list exceeds ${MAX_PATTERNS_COUNT} patterns`,
          )
          .default([]),
      })
      .strict()
      .optional(),
    review: reviewSectionSchema.optional(),
    rules: z
      .array(singleRuleSchema)
      .max(MAX_RULE_COUNT, `Rules list exceeds ${MAX_RULE_COUNT} rules`)
      .refine((rules) => {
        const ids = rules.map((r) => r.id);
        return new Set(ids).size === ids.length;
      }, "Rule IDs must be unique across all configured rules")
      .refine(
        (rules) => rules.filter((r) => r.type === "max_pr_size").length <= 1,
        "At most one max_pr_size rule is allowed",
      )
      .optional(),
  })
  .strict();

export const DEFAULT_CONFIG: ReviewLensConfig = {
  version: 1,
  paths: {
    include: undefined,
    exclude: [],
  },
  review: {
    max_inline_comments: 8,
  },
  rules: [],
};

export async function loadRepositoryConfig(
  githubClient: GitHubPullRequestClient,
  owner: string,
  repo: string,
  baseSha: string,
  options?: { signal?: AbortSignal },
): Promise<EffectiveConfig> {
  const warnings: string[] = [];

  const rawContent = await githubClient.getFileContent(
    owner,
    repo,
    CONFIG_FILE_PATH,
    baseSha,
    options,
  );

  // 1. Missing configuration (HTTP 404)
  if (rawContent === null) {
    return {
      source: "base_commit",
      baseSha,
      status: "missing",
      config: DEFAULT_CONFIG,
      warnings: ["Configuration file .reviewlens.yml not found on base commit"],
    };
  }

  // 2. Bound file size (32 KiB)
  const byteLength = Buffer.byteLength(rawContent, "utf8");
  if (byteLength > MAX_CONFIG_FILE_BYTES) {
    return {
      source: "base_commit",
      baseSha,
      status: "invalid_defaulted",
      config: DEFAULT_CONFIG,
      warnings: [
        `Configuration file exceeds maximum size of ${MAX_CONFIG_FILE_BYTES} bytes (actual: ${byteLength} bytes). Using default configuration.`,
      ],
    };
  }

  // 3. Strict YAML parsing
  let parsedYaml: unknown;
  try {
    parsedYaml = yaml.parse(rawContent, {
      uniqueKeys: true,
      merge: false,
      schema: "core",
    });
  } catch (yamlErr: unknown) {
    const msg = yamlErr instanceof Error ? yamlErr.message : String(yamlErr);
    return {
      source: "base_commit",
      baseSha,
      status: "invalid_defaulted",
      config: DEFAULT_CONFIG,
      warnings: [
        `Failed to parse .reviewlens.yml YAML: ${msg}. Using default configuration.`,
      ],
    };
  }

  // 4. Reject anchors/aliases or functions if parsed as non-object
  if (typeof parsedYaml !== "object" || parsedYaml === null) {
    return {
      source: "base_commit",
      baseSha,
      status: "invalid_defaulted",
      config: DEFAULT_CONFIG,
      warnings: [
        ".reviewlens.yml root must be an object. Using default configuration.",
      ],
    };
  }

  // 5. Zod schema validation
  const validation = reviewLensConfigSchema.safeParse(parsedYaml);
  if (!validation.success) {
    const errorDetails = validation.error.issues
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
    return {
      source: "base_commit",
      baseSha,
      status: "invalid_defaulted",
      config: DEFAULT_CONFIG,
      warnings: [
        `Configuration validation failed: ${errorDetails}. Using default configuration.`,
      ],
    };
  }

  const validated = validation.data;

  return {
    source: "base_commit",
    baseSha,
    status: "loaded",
    config: {
      version: 1,
      paths: {
        include: validated.paths?.include,
        exclude: validated.paths?.exclude ?? [],
      },
      review: {
        max_inline_comments: validated.review?.max_inline_comments ?? 8,
      },
      rules: validated.rules ?? [],
    },
    warnings,
  };
}
