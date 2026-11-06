import type { ValidatedFinding } from "../types/findings.js";

export interface InlineCommentGroup {
  readonly anchorKey: string;
  readonly path: string;
  readonly side: "LEFT" | "RIGHT";
  readonly line: number;
  readonly commitSha: string;
  readonly findings: readonly ValidatedFinding[];
}

export interface GroupedFindingsResult {
  readonly inlineGroups: readonly InlineCommentGroup[];
  readonly nonLineFindings: readonly ValidatedFinding[];
}

export function groupSameAnchorFindings(
  rankedFindings: readonly ValidatedFinding[],
): GroupedFindingsResult {
  const groupsMap = new Map<string, ValidatedFinding[]>();
  const nonLineFindings: ValidatedFinding[] = [];

  for (const finding of rankedFindings) {
    if (
      finding.scope === "line" &&
      finding.primaryEvidence.kind === "code_line"
    ) {
      const ev = finding.primaryEvidence;
      const key = `${ev.path}:${ev.side}:${ev.line}:${ev.commitSha}`;
      const list = groupsMap.get(key) ?? [];
      list.push(finding);
      groupsMap.set(key, list);
    } else {
      nonLineFindings.push(finding);
    }
  }

  const inlineGroups: InlineCommentGroup[] = [];
  for (const [key, groupFindings] of groupsMap) {
    const firstEv = groupFindings[0]!.primaryEvidence as {
      path: string;
      side: "LEFT" | "RIGHT";
      line: number;
      commitSha: string;
    };
    inlineGroups.push({
      anchorKey: key,
      path: firstEv.path,
      side: firstEv.side,
      line: firstEv.line,
      commitSha: firstEv.commitSha,
      findings: groupFindings,
    });
  }

  return {
    inlineGroups,
    nonLineFindings,
  };
}
