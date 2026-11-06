import type { RuleConfigItem } from "@reviewlens/core";

export interface PullRequestRevision {
  headSha: string;
  baseSha: string;
}

export interface ChangedFileMetadata {
  path: string;
  previousPath?: string;
  status: string; // "added" | "modified" | "removed" | "renamed" | etc.
  additions: number;
  deletions: number;
  changes: number;
  sha?: string | null;
  patch?: string; // transient, not saved to persistent storage
}

export type DiffLine =
  | {
      kind: "context";
      content: string;
      oldLine: number;
      newLine: number;
    }
  | {
      kind: "addition";
      content: string;
      newLine: number;
    }
  | {
      kind: "deletion";
      content: string;
      oldLine: number;
    };

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  header: string;
  lines: DiffLine[];
}

export type ParseStatus =
  "parsed" | "patch_unavailable" | "malformed" | "unsupported" | "excluded";

export interface ParsedFileDiff {
  path: string;
  previousPath?: string;
  parseStatus: ParseStatus;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  diagnosticCode?: string;
}

export type ReviewSide = "LEFT" | "RIGHT";

export interface ReviewLocation {
  path: string;
  side: ReviewSide;
  line: number;
  kind: "context" | "addition" | "deletion";
  isChanged: boolean;
  content: string;
  hunkIndex: number;
  commitSha: string;
}

export interface ReviewLocationIndex {
  find(
    path: string,
    side: ReviewSide,
    line: number,
  ): ReviewLocation | undefined;
  getAllForPath(path: string): ReviewLocation[];
  getAll(): ReviewLocation[];
  readonly size: number;
}

export type PathFilterReason =
  | "default_include"
  | "matched_include"
  | "no_include_match"
  | "matched_exclude";

export interface PathFilterDecision {
  path: string;
  previousPath?: string;
  included: boolean;
  reason: PathFilterReason;
  matchedPattern?: string;
}

export interface ReviewConfig {
  max_inline_comments?: number;
}

export interface ReviewLensConfig {
  version: 1;
  paths?: {
    include?: string[];
    exclude?: string[];
  };
  review?: ReviewConfig;
  rules?: RuleConfigItem[];
}

export type ConfigStatus = "loaded" | "missing" | "invalid_defaulted";

export interface EffectiveConfig {
  source: "base_commit";
  baseSha: string;
  status: ConfigStatus;
  config: ReviewLensConfig;
  warnings: string[];
}

export interface PipelineDiagnostic {
  code: string;
  message: string;
  path?: string;
  severity: "info" | "warning" | "error";
}

export interface PreparedFile {
  metadata: ChangedFileMetadata;
  filterDecision: PathFilterDecision;
  parseStatus: ParseStatus;
  diff?: ParsedFileDiff;
  locations?: ReviewLocationIndex;
}

export interface PreparedReviewInput {
  repository: {
    owner: string;
    name: string;
    id?: number;
    isPrivate?: boolean;
    visibility?: string;
  };
  pullRequest: {
    number: number;
    state: "open" | "closed";
    isDraft: boolean;
    baseSha: string;
    baseRef: string;
    headSha: string;
    headRef: string;
    changedFilesCount: number;
  };
  configuration: EffectiveConfig;
  completeness: {
    expectedFileCount: number;
    receivedFileCount: number;
    paginationComplete: boolean;
    revisionVerified: boolean;
  };
  files: PreparedFile[];
  diagnostics: PipelineDiagnostic[];
}

export interface PreparePullRequestInput {
  owner: string;
  repo: string;
  prNumber: number;
  expectedHeadSha: string;
  expectedBaseSha: string;
  signal?: AbortSignal;
}
