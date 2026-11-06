import { getRegisteredRule } from "./registry.js";
import type {
  CandidateFinding,
  DeterministicRule,
  RuleConfigItem,
  RuleContext,
  RuleEngineResult,
  RuleEvaluationOutcome,
  RuleExecutionResult,
} from "../index.js";

export const MAX_CONFIGURED_RULES = 50;
export const MAX_TOTAL_CANDIDATE_FINDINGS = 1000;
export const MAX_FINDINGS_PER_RULE_INSTANCE = 500;

export class RuleEngineResourceLimitError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "RuleEngineResourceLimitError";
    this.code = code;
  }
}

export class UnknownRuleTypeError extends Error {
  readonly code = "UNKNOWN_RULE_TYPE";
  constructor(type: string, ruleId: string) {
    super(
      `Rule '${ruleId}' references unknown or unregistered rule type '${type}'`,
    );
    this.name = "UnknownRuleTypeError";
  }
}

export class RuleExecutionError extends Error {
  readonly code = "RULE_EXECUTION_FAILED";
  readonly ruleId: string;
  constructor(ruleId: string, cause: unknown) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    super(`Rule '${ruleId}' failed with unexpected error: ${msg}`);
    this.name = "RuleExecutionError";
    this.ruleId = ruleId;
  }
}

export function executeRuleEngine(
  context: RuleContext,
  rulesConfig: readonly RuleConfigItem[],
  options?: {
    getRule?: (type: string) => DeterministicRule | undefined;
  },
): RuleEngineResult {
  if (rulesConfig.length > MAX_CONFIGURED_RULES) {
    throw new RuleEngineResourceLimitError(
      "EXCEEDED_MAX_RULES_COUNT",
      `Configured rules count (${rulesConfig.length}) exceeds maximum limit of ${MAX_CONFIGURED_RULES}`,
    );
  }

  const candidateFindings: CandidateFinding[] = [];
  const executionResults: RuleExecutionResult[] = [];
  const warnings: string[] = [];
  let hasPartial = false;
  let activeRulesCount = 0;
  const resolveRule = options?.getRule ?? getRegisteredRule;

  for (const config of rulesConfig) {
    if (!config.enabled) {
      continue;
    }

    activeRulesCount++;
    const ruleImpl = resolveRule(config.type);
    if (!ruleImpl) {
      throw new UnknownRuleTypeError(config.type, config.id);
    }

    let outcome: RuleEvaluationOutcome;
    try {
      outcome = ruleImpl.evaluate(context, config);
    } catch (err) {
      // Unexpected rule exceptions abort the entire current evaluation (fail closed)
      throw new RuleExecutionError(config.id, err);
    }

    if (outcome.candidates.length > MAX_FINDINGS_PER_RULE_INSTANCE) {
      throw new RuleEngineResourceLimitError(
        "EXCEEDED_RULE_INSTANCE_FINDINGS_LIMIT",
        `Rule '${config.id}' generated ${outcome.candidates.length} findings, exceeding the limit of ${MAX_FINDINGS_PER_RULE_INSTANCE}`,
      );
    }

    for (const c of outcome.candidates) {
      candidateFindings.push(c);
      if (candidateFindings.length > MAX_TOTAL_CANDIDATE_FINDINGS) {
        throw new RuleEngineResourceLimitError(
          "EXCEEDED_TOTAL_CANDIDATE_FINDINGS_LIMIT",
          `Total candidate findings exceeded maximum limit of ${MAX_TOTAL_CANDIDATE_FINDINGS}`,
        );
      }
    }

    if (outcome.status === "partial") {
      hasPartial = true;
      if (outcome.reason) {
        warnings.push(
          `Rule '${config.id}' partial coverage: ${outcome.reason}`,
        );
      }
    }

    executionResults.push({
      ruleId: config.id,
      ruleType: config.type,
      status: outcome.status,
      inspectedFilesCount: outcome.inspectedFilesCount,
      inspectedLinesCount: outcome.inspectedLinesCount,
      findingsCount: outcome.candidates.length,
      reason: outcome.reason,
      unmetRequirements: outcome.unmetRequirements,
    });
  }

  let overallCoverage: "complete" | "partial" | "no_rules";
  if (activeRulesCount === 0) {
    overallCoverage = "no_rules";
  } else if (hasPartial) {
    overallCoverage = "partial";
  } else {
    overallCoverage = "complete";
  }

  return {
    candidateFindings,
    executionResults,
    overallCoverage,
    warnings,
  };
}
