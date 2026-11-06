import { createHash } from "node:crypto";
import type {
  CandidateFinding,
  CodeLineEvidence,
  FileRelationshipEvidence,
  PullRequestMetricEvidence,
} from "../types/findings.js";
import type { RuleContext } from "../types/rules.js";

export interface EvidenceValidationResult {
  readonly valid: boolean;
  readonly code?: string;
  readonly reason?: string;
}

export function validateFindingEvidence(
  candidate: CandidateFinding,
  context: RuleContext,
): EvidenceValidationResult {
  const { scope, primaryEvidence } = candidate;

  // 1. Verify scope & evidence type alignment
  if (scope === "line") {
    if (primaryEvidence.kind !== "code_line") {
      return {
        valid: false,
        code: "SCOPE_EVIDENCE_MISMATCH",
        reason: `Line-scoped finding has incompatible evidence kind '${primaryEvidence.kind}'`,
      };
    }
    return validateLineEvidence(primaryEvidence, context);
  }

  if (scope === "file") {
    if (primaryEvidence.kind !== "file_relationship") {
      return {
        valid: false,
        code: "SCOPE_EVIDENCE_MISMATCH",
        reason: `File-scoped finding has incompatible evidence kind '${primaryEvidence.kind}'`,
      };
    }
    return validateFileRelationshipEvidence(primaryEvidence, context);
  }

  if (scope === "pull_request") {
    if (primaryEvidence.kind !== "pull_request_metric") {
      return {
        valid: false,
        code: "SCOPE_EVIDENCE_MISMATCH",
        reason: `PR-scoped finding has incompatible evidence kind '${primaryEvidence.kind}'`,
      };
    }
    return validatePrMetricEvidence(primaryEvidence, context);
  }

  return {
    valid: false,
    code: "UNKNOWN_SCOPE",
    reason: `Unknown finding scope '${scope}'`,
  };
}

function validateLineEvidence(
  evidence: CodeLineEvidence,
  context: RuleContext,
): EvidenceValidationResult {
  const { path, side, line, commitSha, lineHash, hunkIndex, matchRange } =
    evidence;

  // Line coordinate validity
  if (!Number.isSafeInteger(line) || line <= 0) {
    return {
      valid: false,
      code: "INVALID_LINE_COORDINATE",
      reason: `Line coordinate ${line} is invalid`,
    };
  }

  // Commit SHA must equal headSha for additions, or headSha/baseSha for deletions
  const isHead = commitSha === context.pullRequest.headSha;
  const isBase = commitSha === context.pullRequest.baseSha;
  if (side === "RIGHT" && !isHead) {
    return {
      valid: false,
      code: "COMMIT_SHA_MISMATCH",
      reason: `Evidence commit SHA ${commitSha} does not match expected head SHA ${context.pullRequest.headSha}`,
    };
  }
  if (side === "LEFT" && !isHead && !isBase) {
    return {
      valid: false,
      code: "COMMIT_SHA_MISMATCH",
      reason: `Evidence commit SHA ${commitSha} does not match expected revision`,
    };
  }

  // File must exist in prepared snapshot
  const file = context.files.find((f) => f.path === path);
  if (!file) {
    return {
      valid: false,
      code: "FILE_NOT_IN_SNAPSHOT",
      reason: `File '${path}' is not present in the PR snapshot`,
    };
  }

  // File must be eligible
  if (!file.isEligible) {
    return {
      valid: false,
      code: "FILE_EXCLUDED",
      reason: `File '${path}' was excluded by path filters`,
    };
  }

  // File must be successfully parsed
  if (file.parseStatus !== "parsed") {
    return {
      valid: false,
      code: "FILE_DIFF_UNAVAILABLE",
      reason: `File '${path}' has parse status '${file.parseStatus}'`,
    };
  }

  // Find line in file additions (RIGHT) or deletions (LEFT)
  let matchedLine:
    { line: number; content: string; hunkIndex: number } | undefined;
  if (side === "RIGHT") {
    matchedLine = file.additions.find((a) => a.line === line);
  } else if (side === "LEFT") {
    matchedLine = file.deletions?.find((d) => d.line === line);
  } else {
    return {
      valid: false,
      code: "INVALID_DIFF_SIDE",
      reason: `Diff side must be 'LEFT' or 'RIGHT', got '${side}'`,
    };
  }

  if (!matchedLine) {
    return {
      valid: false,
      code: "LINE_NOT_IN_DIFF",
      reason: `Line ${line} on ${side} was not found among ${side === "RIGHT" ? "added" : "deleted"} lines in diff for '${path}'`,
    };
  }

  if (matchedLine.hunkIndex !== hunkIndex) {
    return {
      valid: false,
      code: "HUNK_INDEX_MISMATCH",
      reason: `Hunk index ${hunkIndex} does not match actual hunk index ${matchedLine.hunkIndex}`,
    };
  }

  // Verify line hash against actual source line
  const actualHash = createHash("sha256")
    .update(matchedLine.content, "utf8")
    .digest("hex");

  if (actualHash !== lineHash) {
    return {
      valid: false,
      code: "LINE_HASH_MISMATCH",
      reason: `Line content hash does not match actual line content in diff`,
    };
  }

  // Verify matchRange bounds
  if (matchRange) {
    const { start, end } = matchRange;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end > matchedLine.content.length
    ) {
      return {
        valid: false,
        code: "INVALID_MATCH_RANGE",
        reason: `Match range [${start}, ${end}] is out of bounds for line of length ${matchedLine.content.length}`,
      };
    }
  }

  return { valid: true };
}

function validateFileRelationshipEvidence(
  evidence: FileRelationshipEvidence,
  context: RuleContext,
): EvidenceValidationResult {
  const { sourcePath, expectedPath } = evidence;

  // Source file must exist in snapshot
  const sourceFile = context.files.find((f) => f.path === sourcePath);
  if (!sourceFile) {
    return {
      valid: false,
      code: "SOURCE_FILE_NOT_FOUND",
      reason: `Source file '${sourcePath}' is not present in PR snapshot`,
    };
  }

  if (!sourceFile.isEligible) {
    return {
      valid: false,
      code: "SOURCE_FILE_EXCLUDED",
      reason: `Source file '${sourcePath}' was excluded by path filters`,
    };
  }

  const status = sourceFile.status.toLowerCase();
  if (status === "removed" || status === "deleted") {
    return {
      valid: false,
      code: "SOURCE_FILE_DELETED",
      reason: `Source file '${sourcePath}' was deleted; companion rule does not apply`,
    };
  }

  // Verify expected companion is absent from active changed files
  const companionFile = context.files.find((f) => f.path === expectedPath);
  if (companionFile) {
    const companionStatus = companionFile.status.toLowerCase();
    if (companionStatus !== "removed" && companionStatus !== "deleted") {
      return {
        valid: false,
        code: "COMPANION_ACTUALLY_PRESENT",
        reason: `Companion file '${expectedPath}' is actually present as an active file in the PR`,
      };
    }
  }

  return { valid: true };
}

function validatePrMetricEvidence(
  evidence: PullRequestMetricEvidence,
  context: RuleContext,
): EvidenceValidationResult {
  const { metric, actual, threshold, comparator } = evidence;

  if (comparator !== "greater_than") {
    return {
      valid: false,
      code: "INVALID_COMPARATOR",
      reason: `PR metric comparator must be 'greater_than'`,
    };
  }

  let recalculatedValue = 0;
  if (metric === "changed_files") {
    recalculatedValue = context.metrics.changedFiles;
  } else if (metric === "total_changes") {
    recalculatedValue = context.metrics.totalChanges;
  } else {
    return {
      valid: false,
      code: "UNKNOWN_METRIC",
      reason: `Unknown PR metric '${metric}'`,
    };
  }

  if (recalculatedValue !== actual) {
    return {
      valid: false,
      code: "METRIC_RECALCULATION_MISMATCH",
      reason: `Claimed metric value ${actual} does not match recalculated value ${recalculatedValue}`,
    };
  }

  if (recalculatedValue <= threshold) {
    return {
      valid: false,
      code: "THRESHOLD_NOT_EXCEEDED",
      reason: `Metric value ${recalculatedValue} does not exceed threshold ${threshold} (must be strictly greater)`,
    };
  }

  return { valid: true };
}
