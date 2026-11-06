import { createHash } from "node:crypto";
import { RE2JS } from "re2js";
import type {
  DeterministicRule,
  ForbidRegexConfig,
  RuleContext,
  RuleEvaluationOutcome,
} from "../types/rules.js";
import type { CandidateFinding } from "../types/findings.js";

export const FORBID_REGEX_RULE_VERSION = 1;

export class ForbidRegexRule implements DeterministicRule<ForbidRegexConfig> {
  readonly type = "forbid_regex";
  readonly version = FORBID_REGEX_RULE_VERSION;

  evaluate(
    context: RuleContext,
    config: ForbidRegexConfig,
  ): RuleEvaluationOutcome {
    const flags = config.case_sensitive === false ? RE2JS.CASE_INSENSITIVE : 0;
    const re = RE2JS.compile(config.pattern, flags);

    const candidates: CandidateFinding[] = [];
    let inspectedFilesCount = 0;
    let inspectedLinesCount = 0;
    const unmetRequirements: string[] = [];

    for (const file of context.files) {
      // Excluded files are not eligible
      if (!file.isEligible) {
        continue;
      }

      // Check if eligible file patch was unavailable or could not be parsed
      if (file.parseStatus !== "parsed") {
        unmetRequirements.push(
          `File '${file.path}' is eligible but could not be parsed (status: ${file.parseStatus})`,
        );
        continue;
      }

      inspectedFilesCount++;

      for (const addedLine of file.additions) {
        inspectedLinesCount++;

        const matcher = re.matcher(addedLine.content);
        if (matcher.find()) {
          const start = matcher.start();
          const end = matcher.end();
          const lineHash = createHash("sha256")
            .update(addedLine.content, "utf8")
            .digest("hex");

          candidates.push({
            schemaVersion: 1,
            code: "FORBIDDEN_PATTERN",
            title: "Forbidden pattern detected",
            message: config.message,
            severity: config.severity ?? "medium",
            scope: "line",
            primaryEvidence: {
              kind: "code_line",
              path: file.path,
              side: "RIGHT",
              line: addedLine.line,
              commitSha: addedLine.commitSha,
              lineHash,
              hunkIndex: addedLine.hunkIndex,
              matchRange: { start, end },
            },
          });
        }
      }
    }

    const hasInspectionGaps = unmetRequirements.length > 0;
    const status = hasInspectionGaps ? "partial" : "completed";

    return {
      candidates,
      status,
      inspectedFilesCount,
      inspectedLinesCount,
      reason: hasInspectionGaps
        ? `Rule evaluated with ${unmetRequirements.length} uninspected eligible file(s)`
        : undefined,
      unmetRequirements: hasInspectionGaps ? unmetRequirements : undefined,
    };
  }
}

export const forbidRegexRule = new ForbidRegexRule();
