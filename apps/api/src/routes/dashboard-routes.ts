import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import type {
  PrismaClient,
  Prisma,
  ReviewStatus,
} from "../generated/prisma/client.js";
import { parseCookies } from "../auth/csrf.js";
import {
  SESSION_COOKIE_NAME,
  validateSession,
} from "../auth/session-manager.js";
import type { GitHubUserClient } from "../github/user-client.js";
import { getUserGrants } from "../services/authorization-service.js";

export interface DashboardRoutesOptions {
  prisma: PrismaClient | (() => PrismaClient);
  userClient: GitHubUserClient;
}

/**
 * Authentication middleware for dashboard routes.
 */
export function createRequireAuthMiddleware(getPrisma: () => PrismaClient) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const cookies = parseCookies(req.header("cookie"));
    const sessionToken = cookies[SESSION_COOKIE_NAME];

    if (!sessionToken) {
      return res.status(401).json({
        error: "Unauthorized: Missing session token",
      });
    }

    const authContext = await validateSession(getPrisma(), sessionToken);
    if (!authContext) {
      return res.status(401).json({
        error: "Unauthorized: Invalid or expired session",
      });
    }

    req.user = authContext.user;
    req.session = authContext.session;
    next();
  };
}

export function createDashboardRoutes(options: DashboardRoutesOptions): Router {
  const router = Router();
  const prismaInput = options.prisma;
  const getPrisma = (): PrismaClient => {
    return typeof prismaInput === "function" ? prismaInput() : prismaInput;
  };
  const { userClient } = options;
  const requireAuth = createRequireAuthMiddleware(getPrisma);

  // Apply authentication to all dashboard routes
  router.use(requireAuth);

  /**
   * GET /api/installations
   * Returns only GitHub App installations accessible to the current user.
   */
  router.get("/installations", async (req: Request, res: Response) => {
    const grants = await getUserGrants(
      getPrisma(),
      userClient,
      req.user!,
      req.session!,
    );

    // Count repositories per installation
    const repoCounts = new Map<string, number>();
    for (const repo of grants.repositories) {
      const instIdStr = repo.installationGithubId.toString();
      repoCounts.set(instIdStr, (repoCounts.get(instIdStr) ?? 0) + 1);
    }

    const results = grants.installations.map((inst) => ({
      id: inst.id,
      installationGithubId: inst.installationGithubId.toString(),
      accountLogin: inst.accountLogin,
      accountType: inst.accountType,
      accountAvatarUrl: inst.accountAvatarUrl,
      repositoryCount:
        repoCounts.get(inst.installationGithubId.toString()) ?? 0,
      refreshedAt: inst.refreshedAt,
    }));

    return res.status(200).json(results);
  });

  /**
   * GET /api/repositories
   * Returns authorized repositories with pagination, filtering and search.
   */
  router.get("/repositories", async (req: Request, res: Response) => {
    const grants = await getUserGrants(
      getPrisma(),
      userClient,
      req.user!,
      req.session!,
    );

    let filteredRepos = grants.repositories;

    // Filter by installation if specified
    const installationIdQuery = req.query.installationId;
    if (typeof installationIdQuery === "string" && installationIdQuery.trim()) {
      try {
        const instGithubId = BigInt(installationIdQuery.trim());
        filteredRepos = filteredRepos.filter(
          (r) => r.installationGithubId === instGithubId,
        );
      } catch {
        // Invalid bigInt format -> no matching repos
        filteredRepos = [];
      }
    }

    // Search query
    const search = req.query.search;
    if (typeof search === "string" && search.trim()) {
      const q = search.trim().toLowerCase();
      filteredRepos = filteredRepos.filter(
        (r) =>
          r.fullName.toLowerCase().includes(q) ||
          r.repoName.toLowerCase().includes(q) ||
          r.owner.toLowerCase().includes(q),
      );
    }

    // Sorting
    const sortBy = req.query.sortBy === "name" ? "name" : "recent";
    if (sortBy === "name") {
      filteredRepos.sort((a, b) => a.fullName.localeCompare(b.fullName));
    }

    // Bounded Pagination
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const perPage = Math.min(
      100,
      Math.max(1, parseInt(String(req.query.perPage || "20"), 10) || 20),
    );
    const total = filteredRepos.length;
    const totalPages = Math.ceil(total / perPage) || 1;
    const startIndex = (page - 1) * perPage;
    const paginated = filteredRepos.slice(startIndex, startIndex + perPage);

    // Enrich with database repository status and review run counts where available
    const repoGithubIds = paginated.map((r) => r.repositoryGithubId);
    const dbRepos = await getPrisma().repository.findMany({
      where: { githubRepoId: { in: repoGithubIds } },
      include: {
        _count: {
          select: { reviewRuns: true },
        },
        reviewRuns: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            status: true,
            createdAt: true,
            finishedAt: true,
          },
        },
      },
    });

    const dbRepoMap = new Map(
      dbRepos.map((dr) => [dr.githubRepoId.toString(), dr]),
    );

    const items = paginated.map((r) => {
      const dbRepo = dbRepoMap.get(r.repositoryGithubId.toString());
      const latestRun = dbRepo?.reviewRuns[0];

      return {
        id: dbRepo?.id ?? null,
        repositoryGithubId: r.repositoryGithubId.toString(),
        installationGithubId: r.installationGithubId.toString(),
        fullName: r.fullName,
        owner: r.owner,
        repoName: r.repoName,
        permissions: r.permissions,
        enabled: dbRepo?.enabled ?? false,
        totalReviews: dbRepo?._count.reviewRuns ?? 0,
        latestReviewStatus: latestRun?.status ?? null,
        latestReviewAt: latestRun?.createdAt ?? null,
      };
    });

    return res.status(200).json({
      repositories: items,
      total,
      page,
      perPage,
      totalPages,
    });
  });

  /**
   * GET /api/dashboard/overview
   * Returns aggregate statistics across authorized repositories only.
   */
  router.get("/dashboard/overview", async (req: Request, res: Response) => {
    const grants = await getUserGrants(
      getPrisma(),
      userClient,
      req.user!,
      req.session!,
    );
    const authorizedRepoIds = grants.repositories.map(
      (r) => r.repositoryGithubId,
    );

    if (authorizedRepoIds.length === 0) {
      return res.status(200).json({
        totalRepositories: 0,
        totalReviews: 0,
        statusCounts: {},
        findingsBySeverity: {
          CRITICAL: 0,
          HIGH: 0,
          MEDIUM: 0,
          LOW: 0,
          INFO: 0,
        },
        recentReviews: [],
      });
    }

    // Find DB Repositories belonging to user's authorized repos
    const dbRepos = await getPrisma().repository.findMany({
      where: { githubRepoId: { in: authorizedRepoIds } },
      select: { id: true },
    });
    const dbRepoIds = dbRepos.map((r) => r.id);

    if (dbRepoIds.length === 0) {
      return res.status(200).json({
        totalRepositories: grants.repositories.length,
        totalReviews: 0,
        statusCounts: {},
        findingsBySeverity: {
          CRITICAL: 0,
          HIGH: 0,
          MEDIUM: 0,
          LOW: 0,
          INFO: 0,
        },
        recentReviews: [],
      });
    }

    // 1. Total Reviews
    const totalReviews = await getPrisma().reviewRun.count({
      where: { repositoryId: { in: dbRepoIds } },
    });

    // 2. Status Breakdown
    const reviewRunsGrouped = await getPrisma().reviewRun.groupBy({
      by: ["status"],
      where: { repositoryId: { in: dbRepoIds } },
      _count: { status: true },
    });
    const statusCounts: Record<string, number> = {};
    for (const group of reviewRunsGrouped) {
      statusCounts[group.status] = group._count.status;
    }

    // 3. Findings Breakdown by Severity
    const findingsGrouped = await getPrisma().reviewFinding.groupBy({
      by: ["severity"],
      where: { reviewRun: { repositoryId: { in: dbRepoIds } } },
      _count: { severity: true },
    });
    const findingsBySeverity: Record<string, number> = {
      CRITICAL: 0,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
      INFO: 0,
    };
    for (const fg of findingsGrouped) {
      findingsBySeverity[fg.severity.toUpperCase()] = fg._count.severity;
    }

    // 4. Recent Reviews (5 most recent)
    const recentDbReviews = await getPrisma().reviewRun.findMany({
      where: { repositoryId: { in: dbRepoIds } },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: {
        repository: {
          select: { fullName: true, githubRepoId: true },
        },
      },
    });

    const recentReviews = recentDbReviews.map((r) => ({
      id: r.id,
      prNumber: r.prNumber,
      repository: r.repository.fullName,
      status: r.status,
      filesTotal: r.filesTotal,
      filesReviewed: r.filesReviewed,
      candidateCount: r.candidateCount,
      postedCount: r.postedCount,
      createdAt: r.createdAt,
      finishedAt: r.finishedAt,
    }));

    return res.status(200).json({
      totalRepositories: grants.repositories.length,
      totalReviews,
      statusCounts,
      findingsBySeverity,
      recentReviews,
    });
  });

  /**
   * GET /api/reviews
   * Returns authorized review history with filters and pagination.
   */
  router.get("/reviews", async (req: Request, res: Response) => {
    const grants = await getUserGrants(
      getPrisma(),
      userClient,
      req.user!,
      req.session!,
    );
    const authorizedRepoIds = grants.repositories.map(
      (r) => r.repositoryGithubId,
    );

    if (authorizedRepoIds.length === 0) {
      return res.status(200).json({
        reviews: [],
        total: 0,
        page: 1,
        perPage: 20,
        totalPages: 1,
      });
    }

    const where: Prisma.ReviewRunWhereInput = {
      repository: {
        githubRepoId: { in: authorizedRepoIds },
      },
    };

    // Filter by repositoryId
    if (
      typeof req.query.repositoryId === "string" &&
      req.query.repositoryId.trim()
    ) {
      where.repositoryId = req.query.repositoryId.trim();
    }

    // Filter by installationGithubId
    if (
      typeof req.query.installationId === "string" &&
      req.query.installationId.trim()
    ) {
      try {
        const instGId = BigInt(req.query.installationId.trim());
        const reposForInst = grants.repositories
          .filter((r) => r.installationGithubId === instGId)
          .map((r) => r.repositoryGithubId);
        where.repository = {
          githubRepoId: { in: reposForInst },
        };
      } catch {
        return res.status(200).json({
          reviews: [],
          total: 0,
          page: 1,
          perPage: 20,
          totalPages: 1,
        });
      }
    }

    // Filter by status
    if (typeof req.query.status === "string" && req.query.status.trim()) {
      where.status = req.query.status.trim() as ReviewStatus;
    }

    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const perPage = Math.min(
      100,
      Math.max(1, parseInt(String(req.query.perPage || "20"), 10) || 20),
    );

    const total = await getPrisma().reviewRun.count({ where });
    const totalPages = Math.ceil(total / perPage) || 1;

    const reviews = await getPrisma().reviewRun.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      include: {
        repository: {
          select: {
            id: true,
            fullName: true,
            githubRepoId: true,
          },
        },
      },
    });

    const items = reviews.map((r) => ({
      id: r.id,
      prNumber: r.prNumber,
      repository: {
        id: r.repository.id,
        fullName: r.repository.fullName,
        githubRepoId: r.repository.githubRepoId.toString(),
      },
      headSha: r.headSha,
      baseSha: r.baseSha,
      status: r.status,
      filesTotal: r.filesTotal,
      filesReviewed: r.filesReviewed,
      candidateCount: r.candidateCount,
      postedCount: r.postedCount,
      githubReviewId: r.githubReviewId ? r.githubReviewId.toString() : null,
      createdAt: r.createdAt,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
    }));

    return res.status(200).json({
      reviews: items,
      total,
      page,
      perPage,
      totalPages,
    });
  });

  /**
   * GET /api/reviews/:id
   * Returns details for a single ReviewRun after repository authorization.
   */
  router.get("/reviews/:id", async (req: Request, res: Response) => {
    const idParam = req.params.id;
    const reviewId =
      typeof idParam === "string"
        ? idParam
        : Array.isArray(idParam)
          ? idParam[0]
          : "";
    if (!reviewId) {
      return res.status(404).json({ error: "Review not found" });
    }

    const review = await getPrisma().reviewRun.findUnique({
      where: { id: reviewId },
      include: {
        repository: true,
        aiExecution: {
          select: {
            status: true,
            profile: true,
            primaryModel: true,
            finalModel: true,
            totalChunks: true,
            completedChunks: true,
            totalInputTokens: true,
            totalOutputTokens: true,
          },
        },
      },
    });

    if (!review) {
      return res.status(404).json({ error: "Review not found" });
    }

    // Strict repository authorization check
    const grants = await getUserGrants(
      getPrisma(),
      userClient,
      req.user!,
      req.session!,
    );
    const hasAccess = grants.repositories.some(
      (r) => r.repositoryGithubId === review.repository.githubRepoId,
    );

    if (!hasAccess) {
      // Safe 404 to prevent resource enumeration
      return res.status(404).json({ error: "Review not found" });
    }

    return res.status(200).json({
      id: review.id,
      prNumber: review.prNumber,
      headSha: review.headSha,
      baseSha: review.baseSha,
      status: review.status,
      trigger: review.trigger,
      degradedReason: review.degradedReason,
      failureReason: review.failureReason,
      filesTotal: review.filesTotal,
      filesReviewed: review.filesReviewed,
      candidateCount: review.candidateCount,
      postedCount: review.postedCount,
      githubReviewId: review.githubReviewId
        ? review.githubReviewId.toString()
        : null,
      createdAt: review.createdAt,
      startedAt: review.startedAt,
      finishedAt: review.finishedAt,
      repository: {
        id: review.repository.id,
        fullName: review.repository.fullName,
        githubRepoId: review.repository.githubRepoId.toString(),
      },
      aiExecution: review.aiExecution ?? null,
    });
  });

  /**
   * GET /api/reviews/:id/findings
   * Returns validated findings for a review run after repository authorization.
   */
  router.get("/reviews/:id/findings", async (req: Request, res: Response) => {
    const idParam = req.params.id;
    const reviewId =
      typeof idParam === "string"
        ? idParam
        : Array.isArray(idParam)
          ? idParam[0]
          : "";
    if (!reviewId) {
      return res.status(404).json({ error: "Review not found" });
    }

    const review = await getPrisma().reviewRun.findUnique({
      where: { id: reviewId },
      include: { repository: true },
    });

    if (!review) {
      return res.status(404).json({ error: "Review not found" });
    }

    // Repository authorization check
    const grants = await getUserGrants(
      getPrisma(),
      userClient,
      req.user!,
      req.session!,
    );
    const hasAccess = grants.repositories.some(
      (r) => r.repositoryGithubId === review.repository.githubRepoId,
    );

    if (!hasAccess) {
      return res.status(404).json({ error: "Review not found" });
    }

    const findings = await getPrisma().reviewFinding.findMany({
      where: { reviewRunId: reviewId },
      orderBy: [{ severity: "asc" }, { createdAt: "asc" }],
    });

    const items = findings.map((f) => ({
      id: f.id,
      fingerprint: f.fingerprint,
      provenance: f.provenance,
      ruleId: f.ruleId,
      modelId: f.modelId,
      category: f.category,
      severity: f.severity,
      title: f.title,
      description: f.description,
      recommendation: f.recommendation,
      confidence: f.confidence ? Number(f.confidence) : null,
      filePath: f.filePath,
      line: f.line,
      side: f.side,
      scope: f.scope,
      createdAt: f.createdAt,
    }));

    return res.status(200).json({
      reviewId,
      findings: items,
    });
  });

  /**
   * GET /api/reviews/:id/execution
   * Returns safe AI execution telemetry for a review run after repository authorization.
   */
  router.get("/reviews/:id/execution", async (req: Request, res: Response) => {
    const idParam = req.params.id;
    const reviewId =
      typeof idParam === "string"
        ? idParam
        : Array.isArray(idParam)
          ? idParam[0]
          : "";
    if (!reviewId) {
      return res.status(404).json({ error: "Review not found" });
    }

    const review = await getPrisma().reviewRun.findUnique({
      where: { id: reviewId },
      include: {
        repository: true,
        aiExecution: {
          include: {
            chunks: {
              include: {
                attempts: true,
              },
            },
          },
        },
      },
    });

    if (!review) {
      return res.status(404).json({ error: "Review not found" });
    }

    // Repository authorization check
    const grants = await getUserGrants(
      getPrisma(),
      userClient,
      req.user!,
      req.session!,
    );
    const hasAccess = grants.repositories.some(
      (r) => r.repositoryGithubId === review.repository.githubRepoId,
    );

    if (!hasAccess) {
      return res.status(404).json({ error: "Review not found" });
    }

    const execution = review.aiExecution;
    if (!execution) {
      return res.status(200).json({
        available: false,
        message: "No AI execution record associated with this review run",
      });
    }

    return res.status(200).json({
      available: true,
      id: execution.id,
      status: execution.status,
      profile: execution.profile,
      primaryModel: execution.primaryModel,
      finalModel: execution.finalModel,
      totalChunks: execution.totalChunks,
      completedChunks: execution.completedChunks,
      failedChunks: execution.failedChunks,
      skippedChunks: execution.skippedChunks,
      totalInputTokens: execution.totalInputTokens,
      totalOutputTokens: execution.totalOutputTokens,
      totalCandidatesGenerated: execution.totalCandidatesGenerated,
      totalCandidatesValidated: execution.totalCandidatesValidated,
      failureReason: execution.failureReason,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
      chunks: execution.chunks.map((c) => ({
        id: c.id,
        chunkIndex: c.chunkIndex,
        filePaths: c.filePaths,
        modelId: c.modelId,
        status: c.status,
        inputTokens: c.inputTokens,
        outputTokens: c.outputTokens,
        error: c.error,
        attemptsCount: c.attempts.length,
        attempts: c.attempts.map((a) => ({
          attemptNumber: a.attemptNumber,
          modelId: a.modelId,
          provider: a.provider,
          status: a.status,
          latencyMs: a.latencyMs,
          errorCategory: a.errorCategory,
        })),
      })),
    });
  });

  return router;
}
