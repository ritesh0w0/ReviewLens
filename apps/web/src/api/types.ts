export interface User {
  id: string;
  githubLogin: string;
  avatarUrl: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AuthMeResponse {
  authenticated: boolean;
  user?: User;
  error?: string;
}

export interface InstallationItem {
  id: string;
  installationGithubId: string;
  accountLogin: string;
  accountType: string;
  accountAvatarUrl: string | null;
  repositoryCount: number;
  refreshedAt: string;
}

export interface RepositoryItem {
  id: string | null;
  repositoryGithubId: string;
  installationGithubId: string;
  fullName: string;
  owner: string;
  repoName: string;
  permissions: {
    admin?: boolean;
    push?: boolean;
    pull?: boolean;
  } | null;
  enabled: boolean;
  totalReviews: number;
  latestReviewStatus: string | null;
  latestReviewAt: string | null;
}

export interface RepositoriesResponse {
  repositories: RepositoryItem[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface RecentReviewItem {
  id: string;
  prNumber: number;
  repository: string;
  status: string;
  filesTotal: number | null;
  filesReviewed: number | null;
  candidateCount: number | null;
  postedCount: number | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface DashboardOverviewResponse {
  totalRepositories: number;
  totalReviews: number;
  statusCounts: Record<string, number>;
  findingsBySeverity: {
    CRITICAL: number;
    HIGH: number;
    MEDIUM: number;
    LOW: number;
    INFO: number;
  };
  recentReviews: RecentReviewItem[];
}

export interface ReviewItem {
  id: string;
  prNumber: number;
  repository: {
    id: string;
    fullName: string;
    githubRepoId: string;
  };
  headSha: string;
  baseSha: string;
  status: string;
  filesTotal: number | null;
  filesReviewed: number | null;
  candidateCount: number | null;
  postedCount: number | null;
  githubReviewId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ReviewsResponse {
  reviews: ReviewItem[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface ReviewDetailResponse extends ReviewItem {
  trigger: string;
  degradedReason: string | null;
  failureReason: string | null;
  aiExecution: {
    status: string;
    profile: string;
    primaryModel: string;
    finalModel: string | null;
    totalChunks: number;
    completedChunks: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  } | null;
}

export interface ReviewFindingItem {
  id: string;
  fingerprint: string;
  provenance: "ai" | "deterministic";
  ruleId: string | null;
  modelId: string | null;
  category: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
  title: string;
  description: string;
  recommendation: string;
  confidence: number | null;
  filePath: string | null;
  line: number | null;
  side: "LEFT" | "RIGHT" | null;
  scope: string;
  createdAt: string;
}

export interface ReviewFindingsResponse {
  reviewId: string;
  findings: ReviewFindingItem[];
}

export interface AIChunkAttempt {
  attemptNumber: number;
  modelId: string;
  provider: string;
  status: string;
  latencyMs: number;
  errorCategory: string | null;
}

export interface AIChunkItem {
  id: string;
  chunkIndex: number;
  filePaths: string[];
  modelId: string;
  status: string;
  inputTokens: number;
  outputTokens: number;
  error: string | null;
  attemptsCount: number;
  attempts: AIChunkAttempt[];
}

export interface AIExecutionTelemetryResponse {
  available: boolean;
  message?: string;
  id?: string;
  status?: string;
  profile?: string;
  primaryModel?: string;
  finalModel?: string | null;
  totalChunks?: number;
  completedChunks?: number;
  failedChunks?: number;
  skippedChunks?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalCandidatesGenerated?: number;
  totalCandidatesValidated?: number;
  failureReason?: string | null;
  startedAt?: string;
  completedAt?: string | null;
  chunks?: AIChunkItem[];
}
