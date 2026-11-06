import {
  groupSameAnchorFindings,
  type InlineCommentGroup,
} from "./grouping.js";
import type {
  FindingPresentationDecision,
  ValidatedFinding,
} from "../types/findings.js";

export const DEFAULT_MAX_INLINE_COMMENTS = 8;
export const MAX_ALLOWED_INLINE_COMMENTS = 8;

export interface PresentationPlan {
  readonly inlineGroups: readonly InlineCommentGroup[];
  readonly summaryFindings: readonly ValidatedFinding[];
  readonly suppressedFindings: readonly ValidatedFinding[];
  readonly decisions: readonly FindingPresentationDecision[];
  readonly omittedInlineGroupsCount: number;
  readonly omittedInlineFindingsCount: number;
}

export function planPresentation(
  rankedFindings: readonly ValidatedFinding[],
  maxInlineComments: number = DEFAULT_MAX_INLINE_COMMENTS,
): PresentationPlan {
  const cappedLimit = Math.max(
    0,
    Math.min(maxInlineComments, MAX_ALLOWED_INLINE_COMMENTS),
  );

  const { inlineGroups, nonLineFindings } =
    groupSameAnchorFindings(rankedFindings);

  const decisions: FindingPresentationDecision[] = [];
  const selectedInlineGroups: InlineCommentGroup[] = [];
  const summaryFindings: ValidatedFinding[] = [...nonLineFindings];
  const suppressedFindings: ValidatedFinding[] = [];

  // 1. Non-line findings (file and pull_request) always go to summary
  for (const f of nonLineFindings) {
    decisions.push({
      fingerprint: f.fingerprint,
      presentation: "summary",
      reason: "non_inline_scope",
    });
  }

  // 2. Handle inline groups based on cap
  if (cappedLimit === 0) {
    // If cap is 0, line findings are presented in summary rather than dropped
    for (const group of inlineGroups) {
      for (const f of group.findings) {
        summaryFindings.push(f);
        decisions.push({
          fingerprint: f.fingerprint,
          presentation: "summary",
          reason: "summary_only_policy",
        });
      }
    }

    return {
      inlineGroups: [],
      summaryFindings,
      suppressedFindings: [],
      decisions,
      omittedInlineGroupsCount: inlineGroups.length,
      omittedInlineFindingsCount: inlineGroups.reduce(
        (sum, g) => sum + g.findings.length,
        0,
      ),
    };
  }

  let omittedInlineGroupsCount = 0;
  let omittedInlineFindingsCount = 0;

  for (let i = 0; i < inlineGroups.length; i++) {
    const group = inlineGroups[i]!;
    if (i < cappedLimit) {
      selectedInlineGroups.push(group);
      for (const f of group.findings) {
        decisions.push({
          fingerprint: f.fingerprint,
          presentation: "inline",
          reason:
            group.findings.length > 1 ? "grouped_with_same_anchor" : "selected",
        });
      }
    } else {
      omittedInlineGroupsCount++;
      omittedInlineFindingsCount += group.findings.length;
      for (const f of group.findings) {
        suppressedFindings.push(f);
        decisions.push({
          fingerprint: f.fingerprint,
          presentation: "suppressed",
          reason: "comment_limit",
        });
      }
    }
  }

  return {
    inlineGroups: selectedInlineGroups,
    summaryFindings,
    suppressedFindings,
    decisions,
    omittedInlineGroupsCount,
    omittedInlineFindingsCount,
  };
}
