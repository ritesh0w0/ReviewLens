import type {
  RuleAddedLine,
  RuleDeletedLine,
  RuleContext,
  RuleFileInput,
} from "@reviewlens/core";
import type { PreparedReviewInput } from "./types.js";

export function buildRuleContext(prepared: PreparedReviewInput): RuleContext {
  const files: RuleFileInput[] = [];
  let totalAdditions = 0;
  let totalDeletions = 0;

  for (const file of prepared.files) {
    totalAdditions += file.metadata.additions;
    totalDeletions += file.metadata.deletions;

    const additions: RuleAddedLine[] = [];
    const deletions: RuleDeletedLine[] = [];
    if (file.parseStatus === "parsed" && file.diff) {
      for (let hunkIdx = 0; hunkIdx < file.diff.hunks.length; hunkIdx++) {
        const hunk = file.diff.hunks[hunkIdx]!;
        for (const line of hunk.lines) {
          if (line.kind === "addition") {
            additions.push({
              line: line.newLine,
              content: line.content,
              hunkIndex: hunkIdx,
              commitSha: prepared.pullRequest.headSha,
            });
          } else if (line.kind === "deletion") {
            deletions.push({
              line: line.oldLine,
              content: line.content,
              hunkIndex: hunkIdx,
              commitSha: prepared.pullRequest.baseSha,
            });
          }
        }
      }
    }

    files.push({
      path: file.metadata.path,
      previousPath: file.metadata.previousPath,
      status: file.metadata.status,
      isEligible: file.filterDecision.included,
      parseStatus: file.parseStatus,
      additions,
      deletions,
      metrics: {
        additions: file.metadata.additions,
        deletions: file.metadata.deletions,
        changes: file.metadata.changes,
      },
    });
  }

  const changedFiles = prepared.completeness.receivedFileCount;
  const totalChanges = totalAdditions + totalDeletions;

  return {
    repository: {
      id: prepared.repository.id,
      owner: prepared.repository.owner,
      name: prepared.repository.name,
    },
    pullRequest: {
      number: prepared.pullRequest.number,
      baseSha: prepared.pullRequest.baseSha,
      headSha: prepared.pullRequest.headSha,
    },
    files,
    metrics: {
      changedFiles,
      additions: totalAdditions,
      deletions: totalDeletions,
      totalChanges,
      completenessVerified:
        prepared.completeness.paginationComplete &&
        prepared.completeness.revisionVerified,
    },
  };
}
