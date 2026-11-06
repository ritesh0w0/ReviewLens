export interface GitHubPullRequestInfo {
  state: "open" | "closed";
  headSha: string;
  baseSha: string;
  prNumber: number;
  isDraft?: boolean;
  baseRef?: string;
  headRef?: string;
  changedFilesCount?: number;
  merged?: boolean;
  isRepoPrivate?: boolean;
  repoVisibility?: string;
}

export interface GitHubChangedFileItem {
  filename: string;
  previous_filename?: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  sha?: string | null;
  patch?: string;
}

export interface GitHubReviewItem {
  id: number;
  body: string;
  state: string;
  commit_id?: string;
  user?: {
    login: string;
    type?: string;
    id?: number;
  };
  submitted_at?: string;
}

export interface GitHubInlineCommentInput {
  path: string;
  line: number;
  side?: "LEFT" | "RIGHT";
  body: string;
}

export interface CreateReviewInput {
  commitSha: string;
  body: string;
  event: "COMMENT";
  comments?: GitHubInlineCommentInput[];
}

export interface AuthenticatedAppInfo {
  id: number;
  slug?: string;
  login?: string;
}

export interface GitHubPullRequestClient {
  getPullRequest(
    owner: string,
    repo: string,
    pullNumber: number,
    options?: { signal?: AbortSignal },
  ): Promise<GitHubPullRequestInfo>;

  getPullRequestFiles(
    owner: string,
    repo: string,
    pullNumber: number,
    options?: { signal?: AbortSignal; page?: number; perPage?: number },
  ): Promise<GitHubChangedFileItem[]>;

  getFileContent(
    owner: string,
    repo: string,
    path: string,
    ref: string,
    options?: { signal?: AbortSignal },
  ): Promise<string | null>;

  listReviews(
    owner: string,
    repo: string,
    pullNumber: number,
    options?: { signal?: AbortSignal },
  ): Promise<GitHubReviewItem[]>;

  createCommentReview(
    owner: string,
    repo: string,
    pullNumber: number,
    commitSha: string,
    body: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ id: number }>;

  createReview(
    owner: string,
    repo: string,
    pullNumber: number,
    input: CreateReviewInput,
    options?: { signal?: AbortSignal },
  ): Promise<{ id: number }>;

  getAuthenticatedApp(options?: {
    signal?: AbortSignal;
  }): Promise<AuthenticatedAppInfo>;
}

export function formatReviewMarker(runId: string): string {
  return `<!-- reviewlens:run:${runId} -->`;
}

export function formatAdvisoryComment(runId: string): string {
  const marker = formatReviewMarker(runId);
  return `ReviewLens integration check: this pull request was received, durably scheduled and processed by the ReviewLens worker. Automated code analysis is not yet enabled in this build.\n\n${marker}`;
}
