import type {
  DeterministicRule,
  RequireCompanionConfig,
  RuleContext,
  RuleEvaluationOutcome,
} from "../types/rules.js";
import type { CandidateFinding } from "../types/findings.js";

export const REQUIRE_COMPANION_RULE_VERSION = 1;

const DELETED_STATUSES = new Set(["removed", "deleted"]);

export class RequireCompanionRule implements DeterministicRule<RequireCompanionConfig> {
  readonly type = "require_companion";
  readonly version = REQUIRE_COMPANION_RULE_VERSION;

  evaluate(
    context: RuleContext,
    config: RequireCompanionConfig,
  ): RuleEvaluationOutcome {
    const { source_suffix, companion_suffix } = config;

    // Index all active changed files in the PR by path
    // Complete metadata is inspected regardless of path filtering
    const activeFilesByPath = new Set<string>();
    for (const f of context.files) {
      if (!DELETED_STATUSES.has(f.status.toLowerCase())) {
        activeFilesByPath.add(f.path);
      }
    }

    const candidates: CandidateFinding[] = [];
    let inspectedFilesCount = 0;

    for (const file of context.files) {
      // Must be eligible by path filtering
      if (!file.isEligible) {
        continue;
      }

      // Deleted source files are not checked
      if (DELETED_STATUSES.has(file.status.toLowerCase())) {
        continue;
      }

      // Check if file path ends with source suffix
      if (!file.path.endsWith(source_suffix)) {
        continue;
      }

      inspectedFilesCount++;

      // Literal suffix transformation
      const baseStem = file.path.slice(0, -source_suffix.length);
      const expectedPath = `${baseStem}${companion_suffix}`;

      // Check if active companion is present in PR
      const companionIsPresent = activeFilesByPath.has(expectedPath);
      if (!companionIsPresent) {
        candidates.push({
          schemaVersion: 1,
          code: "COMPANION_MISSING",
          title: "Required companion file missing from pull request",
          message: `The companion file '${expectedPath}' must also be changed in this pull request.`,
          severity: config.severity ?? "low",
          scope: "file",
          primaryEvidence: {
            kind: "file_relationship",
            relation: "companion_missing_from_pr",
            sourcePath: file.path,
            expectedPath,
            companionPresentInPr: false,
          },
        });
      }
    }

    const status = inspectedFilesCount === 0 ? "not_applicable" : "completed";

    return {
      candidates,
      status,
      inspectedFilesCount,
      inspectedLinesCount: 0,
      reason:
        inspectedFilesCount === 0
          ? "No eligible source files matched the configured source suffix"
          : undefined,
    };
  }
}

export const requireCompanionRule = new RequireCompanionRule();
