import {
  computeConfigDigest,
  computeFindingFingerprint,
  deduplicateFindings,
  executeRuleEngine,
  planPresentation,
  rankFindings,
  validateFindingEvidence,
  type FindingOrigin,
  type PresentationPlan,
  type RuleConfigItem,
  type ValidatedFinding,
} from "@reviewlens/core";
import { buildRuleContext } from "../pipeline/rule-context-adapter.js";
import type { PreparedReviewInput } from "../pipeline/types.js";
import {
  buildReviewPayload,
  type BuiltReviewPayload,
} from "./payload-builder.js";

export class PermanentConfigurationError extends Error {
  readonly code = "INVALID_REPOSITORY_CONFIGURATION";
  constructor(message: string) {
    super(message);
    this.name = "PermanentConfigurationError";
  }
}

export class EvidenceValidationError extends Error {
  readonly code = "EVIDENCE_VALIDATION_FAILED";
  constructor(code: string, reason?: string) {
    super(`Evidence validation failed: ${code} (${reason ?? "no reason"})`);
    this.name = "EvidenceValidationError";
  }
}

export interface ReviewOrchestratorResult {
  hasReviewToPublish: boolean;
  overallCoverage: "complete" | "partial" | "no_rules";
  findingsCount: number;
  validatedFindings: readonly ValidatedFinding[];
  plan: PresentationPlan;
  payload: BuiltReviewPayload | null;
  warnings: readonly string[];
}

export interface ReviewEvaluationOptions {
  runId: string;
  additionalFindings?: readonly ValidatedFinding[];
  aiCoverageNotice?: string;
}

export function evaluatePullRequestReview(
  prepared: PreparedReviewInput,
  options: ReviewEvaluationOptions,
): ReviewOrchestratorResult {
  // 1. In M3, invalid configuration must fail closed
  if (prepared.configuration.status === "invalid_defaulted") {
    const errorMsg =
      prepared.configuration.warnings.join("; ") ||
      "Invalid .reviewlens.yml on base commit";
    throw new PermanentConfigurationError(
      `Repository configuration on base commit is invalid: ${errorMsg}`,
    );
  }

  const rules: RuleConfigItem[] = prepared.configuration.config.rules ?? [];
  const maxInlineComments =
    prepared.configuration.config.review?.max_inline_comments ?? 8;

  // Genuinely missing config or empty rules
  if (rules.length === 0) {
    const additional = options.additionalFindings ?? [];
    if (additional.length === 0) {
      const emptyPlan: PresentationPlan = {
        inlineGroups: [],
        summaryFindings: [],
        suppressedFindings: [],
        decisions: [],
        omittedInlineGroupsCount: 0,
        omittedInlineFindingsCount: 0,
      };

      return {
        hasReviewToPublish: false,
        overallCoverage: "no_rules",
        findingsCount: 0,
        validatedFindings: [],
        plan: emptyPlan,
        payload: null,
        warnings: prepared.configuration.warnings,
      };
    }

    // Rules empty but AI findings exist
    const deduplicated = deduplicateFindings(additional);
    const ranked = rankFindings(deduplicated);
    const plan = planPresentation(ranked, maxInlineComments);
    const payload = buildReviewPayload({
      runId: options.runId,
      plan,
      overallCoverage: "complete",
      coverageWarnings: prepared.configuration.warnings,
      repoName: prepared.repository.name,
      aiCoverageNotice: options.aiCoverageNotice,
    });

    return {
      hasReviewToPublish: true,
      overallCoverage: "complete",
      findingsCount: ranked.length,
      validatedFindings: ranked,
      plan,
      payload,
      warnings: prepared.configuration.warnings,
    };
  }

  // 2. Build RuleContext
  const ruleContext = buildRuleContext(prepared);

  // 3. Execute Rule Engine
  const engineResult = executeRuleEngine(ruleContext, rules);

  // 4. Validate evidence for every candidate
  const ruleConfigById = new Map<string, RuleConfigItem>();
  for (const r of rules) {
    ruleConfigById.set(r.id, r);
  }

  // Map to associate candidate finding with originating rule
  // Rule order and candidates are known
  const validatedFindings: ValidatedFinding[] = [];
  const occurrenceCountByCoord = new Map<string, number>();

  const repoIdentifier =
    prepared.repository.id !== undefined
      ? String(prepared.repository.id)
      : `${prepared.repository.owner}/${prepared.repository.name}`;

  for (const candidate of engineResult.candidateFindings) {
    // Independent evidence validation against M2 prepared input
    const validation = validateFindingEvidence(candidate, ruleContext);
    if (!validation.valid) {
      throw new EvidenceValidationError(
        validation.code ?? "UNKNOWN_EVIDENCE_ERROR",
        validation.reason,
      );
    }

    // Determine originating rule
    let matchedRule: RuleConfigItem | undefined;
    for (const r of rules) {
      if (candidate.code === "FORBIDDEN_PATTERN" && r.type === "forbid_regex") {
        if (candidate.message === r.message) {
          matchedRule = r;
          break;
        }
      } else if (
        candidate.code === "COMPANION_MISSING" &&
        r.type === "require_companion"
      ) {
        matchedRule = r;
        break;
      } else if (
        candidate.code === "PR_SIZE_EXCEEDED" &&
        r.type === "max_pr_size"
      ) {
        matchedRule = r;
        break;
      }
    }

    // Fallback to first rule of matching type
    if (!matchedRule) {
      if (candidate.scope === "line") {
        matchedRule = rules.find((r) => r.type === "forbid_regex");
      } else if (candidate.scope === "file") {
        matchedRule = rules.find((r) => r.type === "require_companion");
      } else {
        matchedRule = rules.find((r) => r.type === "max_pr_size");
      }
    }

    const ruleId = matchedRule?.id ?? "default_rule";
    const ruleType = matchedRule?.type ?? "forbid_regex";
    const configDigest = matchedRule ? computeConfigDigest(matchedRule) : "";

    const origin: FindingOrigin = {
      kind: "deterministic_rule",
      ruleId,
      ruleType,
      ruleVersion: 1,
      configDigest,
    };

    // Stable occurrence discriminator for identical line patterns
    let occurrence = 0;
    if (candidate.primaryEvidence.kind === "code_line") {
      const coordKey = `${candidate.primaryEvidence.path}:${candidate.primaryEvidence.lineHash}`;
      occurrence = occurrenceCountByCoord.get(coordKey) ?? 0;
      occurrenceCountByCoord.set(coordKey, occurrence + 1);
    }

    const fingerprint = computeFindingFingerprint(
      candidate,
      repoIdentifier,
      prepared.pullRequest.number,
      origin,
      occurrence,
    );

    validatedFindings.push({
      ...candidate,
      origin,
      fingerprint,
      fingerprintVersion: 1,
    });
  }

  // Merge any additional findings (e.g. AI-validated findings)
  const allFindings = [
    ...validatedFindings,
    ...(options.additionalFindings ?? []),
  ];

  // 5. Deduplicate
  const deduplicated = deduplicateFindings(allFindings);

  // 6. Rank
  const ranked = rankFindings(deduplicated);

  // 7. Plan presentation
  const plan = planPresentation(ranked, maxInlineComments);

  // 8. Decide review publication necessity
  const allWarnings = [
    ...prepared.configuration.warnings,
    ...engineResult.warnings,
  ];

  let hasReviewToPublish = false;
  let payload: BuiltReviewPayload | null = null;

  if (ranked.length > 0) {
    hasReviewToPublish = true;
    payload = buildReviewPayload({
      runId: options.runId,
      plan,
      overallCoverage: engineResult.overallCoverage,
      coverageWarnings: allWarnings,
      repoName: prepared.repository.name,
      aiCoverageNotice: options.aiCoverageNotice,
    });
  } else if (engineResult.overallCoverage === "partial") {
    // No findings, but partial coverage: must publish warning review!
    hasReviewToPublish = true;
    payload = buildReviewPayload({
      runId: options.runId,
      plan,
      overallCoverage: "partial",
      coverageWarnings: allWarnings,
      repoName: prepared.repository.name,
      aiCoverageNotice: options.aiCoverageNotice,
    });
  } else {
    // No findings and complete coverage: do NOT publish empty review!
    hasReviewToPublish = false;
    payload = null;
  }

  return {
    hasReviewToPublish,
    overallCoverage: engineResult.overallCoverage,
    findingsCount: ranked.length,
    validatedFindings: ranked,
    plan,
    payload,
    warnings: allWarnings,
  };
}
