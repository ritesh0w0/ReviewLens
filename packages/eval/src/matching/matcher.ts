import type { ValidatedFinding } from "@reviewlens/core";
import type { EvaluationCase, ExpectedFinding } from "../dataset/schema.js";
import {
  type AdjudicationOutcome,
  type AdjudicationRecord,
  AdjudicationStore,
} from "./adjudication.js";

export interface CandidateEvaluationMapping {
  readonly finding: ValidatedFinding;
  readonly outcome: AdjudicationOutcome;
  readonly matchedIssueId?: string;
  readonly isLocalizationAccurate: boolean;
  readonly lineOffset: number;
  readonly adjudicationSource: "human_adjudication" | "automated_proposal";
  readonly reasoning?: string;
}

export interface CaseMatchResult {
  readonly caseId: string;
  readonly truePositives: readonly CandidateEvaluationMapping[];
  readonly falsePositives: readonly CandidateEvaluationMapping[];
  readonly falseNegatives: readonly ExpectedFinding[];
  readonly duplicates: readonly CandidateEvaluationMapping[];
  readonly unadjudicated: readonly CandidateEvaluationMapping[];
  readonly allCandidateMappings: readonly CandidateEvaluationMapping[];
}

export function extractFindingLocation(
  finding:
    | ValidatedFinding
    | {
        primaryEvidence?: any;
        targetPath?: string;
        targetSide?: "LEFT" | "RIGHT";
        targetLine?: number;
      },
): {
  path?: string;
  side?: "LEFT" | "RIGHT";
  line?: number;
} {
  if (finding.primaryEvidence?.kind === "code_line") {
    return {
      path: finding.primaryEvidence.path,
      side: finding.primaryEvidence.side,
      line: finding.primaryEvidence.line,
    };
  }
  if ("targetPath" in finding && finding.targetPath) {
    return {
      path: finding.targetPath,
      side: finding.targetSide,
      line: finding.targetLine,
    };
  }
  return {};
}

export function extractFindingCategory(
  finding: ValidatedFinding | { code?: string; category?: string },
): string {
  if (
    "category" in finding &&
    finding.category &&
    typeof finding.category === "string"
  ) {
    return finding.category.toLowerCase();
  }
  const code = (
    "code" in finding && finding.code ? finding.code : ""
  ).toUpperCase();
  if (code.includes("SECURITY")) return "security";
  if (code.includes("CORRECTNESS")) return "correctness";
  if (code.includes("RELIABILITY")) return "reliability";
  if (code.includes("PERFORMANCE")) return "performance";
  if (code.includes("RESOURCE_USAGE") || code.includes("RESOURCE"))
    return "resource_usage";
  return "general";
}

export function evaluateCaseFindings(
  evalCase: EvaluationCase,
  findings: readonly ValidatedFinding[],
  adjudicationStore: AdjudicationStore = new AdjudicationStore(),
): CaseMatchResult {
  const candidateMappings: CandidateEvaluationMapping[] = [];
  const matchedIssueIds = new Set<string>();

  for (const finding of findings) {
    const loc = extractFindingLocation(finding);
    const category = extractFindingCategory(finding);
    const humanAdj = adjudicationStore.get(finding.fingerprint);

    if (humanAdj) {
      // 1. Prioritize human adjudication
      const expected = evalCase.expectedFindings.find(
        (ef) => ef.issueId === humanAdj.matchedIssueId,
      );

      let isLocalizationAccurate = false;
      let lineOffset = 0;

      if (expected && loc.line !== undefined && loc.path && loc.side) {
        const inLineRange =
          loc.line >= expected.lineRange.start &&
          loc.line <= expected.lineRange.end;
        isLocalizationAccurate =
          inLineRange &&
          loc.side === expected.targetSide &&
          loc.path === expected.targetPath;

        lineOffset = inLineRange
          ? 0
          : Math.min(
              Math.abs(loc.line - expected.lineRange.start),
              Math.abs(loc.line - expected.lineRange.end),
            );
      }

      // Check for duplicate match inflation
      let effectiveOutcome: AdjudicationOutcome = humanAdj.outcome;
      if (humanAdj.outcome === "MATCH" && humanAdj.matchedIssueId) {
        if (matchedIssueIds.has(humanAdj.matchedIssueId)) {
          effectiveOutcome = "DUPLICATE";
        } else {
          matchedIssueIds.add(humanAdj.matchedIssueId);
        }
      }

      candidateMappings.push({
        finding,
        outcome: effectiveOutcome,
        matchedIssueId: humanAdj.matchedIssueId,
        isLocalizationAccurate,
        lineOffset,
        adjudicationSource: "human_adjudication",
        reasoning:
          humanAdj.reviewerNotes ?? "Human reviewer adjudicated finding",
      });
      continue;
    }

    // 2. Automated evaluation logic
    if (evalCase.expectedFindings.length === 0) {
      // Clean case: any reported finding is a False Positive
      candidateMappings.push({
        finding,
        outcome: "FALSE_POSITIVE",
        isLocalizationAccurate: false,
        lineOffset: 0,
        adjudicationSource: "automated_proposal",
        reasoning: "Reported on a clean case with zero expected defects",
      });
      continue;
    }

    // Try finding a matching expected issue
    let bestMatch:
      | { expected: ExpectedFinding; lineOffset: number; exactLoc: boolean }
      | undefined;

    for (const expected of evalCase.expectedFindings) {
      if (
        loc.path !== expected.targetPath ||
        loc.side !== expected.targetSide
      ) {
        continue;
      }

      if (loc.line === undefined) continue;

      const inRange =
        loc.line >= expected.lineRange.start &&
        loc.line <= expected.lineRange.end;
      const offset = inRange
        ? 0
        : Math.min(
            Math.abs(loc.line - expected.lineRange.start),
            Math.abs(loc.line - expected.lineRange.end),
          );

      // Match within expected line range or tolerance window (within ±3 lines)
      if (offset <= 3) {
        const catMatch =
          category === "general" || category === expected.category;
        if (catMatch) {
          if (!bestMatch || offset < bestMatch.lineOffset) {
            bestMatch = { expected, lineOffset: offset, exactLoc: inRange };
          }
        }
      }
    }

    if (bestMatch) {
      const issueId = bestMatch.expected.issueId;
      if (matchedIssueIds.has(issueId)) {
        // Issue already detected by another finding: treat as duplicate
        candidateMappings.push({
          finding,
          outcome: "DUPLICATE",
          matchedIssueId: issueId,
          isLocalizationAccurate: bestMatch.exactLoc,
          lineOffset: bestMatch.lineOffset,
          adjudicationSource: "automated_proposal",
          reasoning: `Duplicate report for expected issue ${issueId}`,
        });
      } else {
        matchedIssueIds.add(issueId);
        candidateMappings.push({
          finding,
          outcome: "MATCH",
          matchedIssueId: issueId,
          isLocalizationAccurate: bestMatch.exactLoc,
          lineOffset: bestMatch.lineOffset,
          adjudicationSource: "automated_proposal",
          reasoning: `Matches expected issue ${issueId}`,
        });
      }
    } else {
      // No match found: classify as False Positive (or Needs Review if ambiguous)
      candidateMappings.push({
        finding,
        outcome: "FALSE_POSITIVE",
        isLocalizationAccurate: false,
        lineOffset: 0,
        adjudicationSource: "automated_proposal",
        reasoning: "Does not match any expected issue location or category",
      });
    }
  }

  // Identify False Negatives: expected issues that were not detected by any candidate
  const falseNegatives = evalCase.expectedFindings.filter(
    (ef) => !matchedIssueIds.has(ef.issueId),
  );

  const truePositives = candidateMappings.filter((m) => m.outcome === "MATCH");
  const falsePositives = candidateMappings.filter(
    (m) => m.outcome === "FALSE_POSITIVE" || m.outcome === "NOT_ACTIONABLE",
  );
  const duplicates = candidateMappings.filter((m) => m.outcome === "DUPLICATE");
  const unadjudicated = candidateMappings.filter(
    (m) => m.outcome === "NEEDS_REVIEW",
  );

  return {
    caseId: evalCase.caseId,
    truePositives,
    falsePositives,
    falseNegatives,
    duplicates,
    unadjudicated,
    allCandidateMappings: candidateMappings,
  };
}
