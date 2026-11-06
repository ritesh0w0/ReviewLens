import type {
  DeterministicRule,
  MaxPrSizeConfig,
  RuleContext,
  RuleEvaluationOutcome,
} from "../types/rules.js";
import type {
  CandidateFinding,
  PullRequestMetricEvidence,
} from "../types/findings.js";

export const MAX_PR_SIZE_RULE_VERSION = 1;

export class MaxPrSizeRule implements DeterministicRule<MaxPrSizeConfig> {
  readonly type = "max_pr_size";
  readonly version = MAX_PR_SIZE_RULE_VERSION;

  evaluate(
    context: RuleContext,
    config: MaxPrSizeConfig,
  ): RuleEvaluationOutcome {
    const { max_files, max_total_changes } = config;
    const { changedFiles, totalChanges } = context.metrics;

    const exceededEvidences: PullRequestMetricEvidence[] = [];
    const violationParts: string[] = [];

    // Check files threshold: strict >
    if (max_files !== undefined && changedFiles > max_files) {
      exceededEvidences.push({
        kind: "pull_request_metric",
        metric: "changed_files",
        actual: changedFiles,
        threshold: max_files,
        comparator: "greater_than",
      });
      violationParts.push(
        `${changedFiles} changed files (limit: ${max_files})`,
      );
    }

    // Check total changes threshold: strict >
    if (max_total_changes !== undefined && totalChanges > max_total_changes) {
      exceededEvidences.push({
        kind: "pull_request_metric",
        metric: "total_changes",
        actual: totalChanges,
        threshold: max_total_changes,
        comparator: "greater_than",
      });
      violationParts.push(
        `${totalChanges} total changes (limit: ${max_total_changes})`,
      );
    }

    const candidates: CandidateFinding[] = [];

    if (exceededEvidences.length > 0) {
      const primaryEvidence = exceededEvidences[0]!;
      const supportingEvidence = exceededEvidences.slice(1);

      candidates.push({
        schemaVersion: 1,
        code: "PR_SIZE_EXCEEDED",
        title: "Pull request exceeds recommended size limit",
        message: `Pull request size limit exceeded: ${violationParts.join("; ")}. Consider breaking this change into smaller, focused pull requests.`,
        severity: config.severity ?? "low",
        scope: "pull_request",
        primaryEvidence,
        supportingEvidence:
          supportingEvidence.length > 0 ? supportingEvidence : undefined,
      });
    }

    return {
      candidates,
      status: "completed",
      inspectedFilesCount: context.files.length,
      inspectedLinesCount: 0,
    };
  }
}

export const maxPrSizeRule = new MaxPrSizeRule();
