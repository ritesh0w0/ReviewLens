export type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";

export type FindingScope = "line" | "file" | "pull_request";

export interface CodeLineEvidence {
  readonly kind: "code_line";
  readonly path: string;
  readonly side: "LEFT" | "RIGHT";
  readonly line: number;
  readonly commitSha: string;
  readonly lineHash: string;
  readonly hunkIndex: number;
  readonly matchRange?: {
    readonly start: number;
    readonly end: number;
  };
  readonly contextHash?: string;
}

export interface FileRelationshipEvidence {
  readonly kind: "file_relationship";
  readonly relation: "companion_missing_from_pr";
  readonly sourcePath: string;
  readonly expectedPath: string;
  readonly companionPresentInPr: false;
}

export interface PullRequestMetricEvidence {
  readonly kind: "pull_request_metric";
  readonly metric: "changed_files" | "total_changes";
  readonly actual: number;
  readonly threshold: number;
  readonly comparator: "greater_than";
}

export type FindingEvidence =
  CodeLineEvidence | FileRelationshipEvidence | PullRequestMetricEvidence;

export interface CandidateFinding {
  readonly schemaVersion: 1;
  readonly code: string;
  readonly title: string;
  readonly message: string;
  readonly severity: FindingSeverity;
  readonly scope: FindingScope;
  readonly primaryEvidence: FindingEvidence;
  readonly supportingEvidence?: readonly FindingEvidence[];
}

export type FindingOrigin =
  | {
      readonly kind: "deterministic_rule";
      readonly ruleId: string;
      readonly ruleType: string;
      readonly ruleVersion: number;
      readonly configDigest: string;
    }
  | {
      readonly kind: "ai_model";
      readonly detectorId: string;
      readonly detectorVersion: string;
    };

export interface ValidatedFinding extends CandidateFinding {
  readonly origin: FindingOrigin;
  readonly fingerprint: string;
  readonly fingerprintVersion: 1;
  readonly confidence?: number;
}

export type PresentationMode = "inline" | "summary" | "suppressed";

export type PresentationReason =
  | "selected"
  | "non_inline_scope"
  | "comment_limit"
  | "grouped_with_same_anchor"
  | "summary_only_policy";

export interface FindingPresentationDecision {
  readonly fingerprint: string;
  readonly presentation: PresentationMode;
  readonly reason: PresentationReason;
}
