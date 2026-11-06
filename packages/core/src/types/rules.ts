import type { CandidateFinding, FindingSeverity } from "./findings.js";

export interface RuleAddedLine {
  readonly line: number;
  readonly content: string;
  readonly hunkIndex: number;
  readonly commitSha: string;
}

export interface RuleDeletedLine {
  readonly line: number;
  readonly content: string;
  readonly hunkIndex: number;
  readonly commitSha: string;
}

export interface RuleFileInput {
  readonly path: string;
  readonly previousPath?: string;
  readonly status: string;
  readonly isEligible: boolean;
  readonly parseStatus: string;
  readonly additions: readonly RuleAddedLine[];
  readonly deletions?: readonly RuleDeletedLine[];
  readonly metrics: {
    readonly additions: number;
    readonly deletions: number;
    readonly changes: number;
  };
}

export interface RuleMetrics {
  readonly changedFiles: number;
  readonly additions: number;
  readonly deletions: number;
  readonly totalChanges: number;
  readonly completenessVerified: boolean;
}

export interface RuleContext {
  readonly repository: {
    readonly id?: number;
    readonly owner: string;
    readonly name: string;
  };
  readonly pullRequest: {
    readonly number: number;
    readonly baseSha: string;
    readonly headSha: string;
  };
  readonly files: readonly RuleFileInput[];
  readonly metrics: RuleMetrics;
}

export interface ForbidRegexConfig {
  readonly id: string;
  readonly type: "forbid_regex";
  readonly enabled: boolean;
  readonly pattern: string;
  readonly case_sensitive?: boolean;
  readonly message: string;
  readonly severity?: FindingSeverity;
}

export interface RequireCompanionConfig {
  readonly id: string;
  readonly type: "require_companion";
  readonly enabled: boolean;
  readonly source_suffix: string;
  readonly companion_suffix: string;
  readonly severity?: FindingSeverity;
}

export interface MaxPrSizeConfig {
  readonly id: string;
  readonly type: "max_pr_size";
  readonly enabled: boolean;
  readonly max_files?: number;
  readonly max_total_changes?: number;
  readonly severity?: FindingSeverity;
}

export type RuleConfigItem =
  ForbidRegexConfig | RequireCompanionConfig | MaxPrSizeConfig;

export type RuleExecutionStatus =
  "completed" | "partial" | "not_applicable" | "failed";

export interface RuleEvaluationOutcome {
  readonly candidates: readonly CandidateFinding[];
  readonly status: RuleExecutionStatus;
  readonly inspectedFilesCount: number;
  readonly inspectedLinesCount: number;
  readonly reason?: string;
  readonly unmetRequirements?: readonly string[];
}

export interface DeterministicRule<
  TConfig extends RuleConfigItem = RuleConfigItem,
> {
  readonly type: TConfig["type"];
  readonly version: number;
  evaluate(context: RuleContext, config: TConfig): RuleEvaluationOutcome;
}

export interface RuleExecutionResult {
  readonly ruleId: string;
  readonly ruleType: string;
  readonly status: RuleExecutionStatus;
  readonly inspectedFilesCount: number;
  readonly inspectedLinesCount: number;
  readonly findingsCount: number;
  readonly reason?: string;
  readonly unmetRequirements?: readonly string[];
}

export interface RuleEngineResult {
  readonly candidateFindings: readonly CandidateFinding[];
  readonly executionResults: readonly RuleExecutionResult[];
  readonly overallCoverage: "complete" | "partial" | "no_rules";
  readonly warnings: readonly string[];
}
