import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchCsrfToken,
  apiFetch,
  fetchMe,
  logout,
  fetchInstallations,
  fetchRepositories,
  fetchDashboardOverview,
  fetchReviews,
  fetchReviewDetail,
  fetchReviewFindings,
  fetchReviewExecution,
} from "./client.js";

describe("Web API Client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetchCsrfToken requests token and caches it", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ csrfToken: "csrf-token-abc-123" }),
    } as any);

    const token = await fetchCsrfToken();
    expect(token).toBe("csrf-token-abc-123");
    expect(fetchSpy).toHaveBeenCalledWith("/api/auth/csrf", {
      credentials: "include",
    });

    // Second call should return cached token without fetch
    const cached = await fetchCsrfToken();
    expect(cached).toBe("csrf-token-abc-123");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("apiFetch attaches CSRF token on POST requests", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    } as any);

    const res = await apiFetch<{ success: boolean }>("/api/test-post", {
      method: "POST",
      body: JSON.stringify({ hello: "world" }),
    });

    expect(res).toEqual({ success: true });
    expect(fetchSpy).toHaveBeenCalled();
    const calledHeaders = fetchSpy.mock.calls[0][1]?.headers as Headers;
    expect(calledHeaders.get("x-csrf-token")).toBe("csrf-token-abc-123");
  });

  it("fetchMe calls /api/auth/me", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        authenticated: true,
        user: { id: "u1", githubLogin: "alice" },
      }),
    } as any);

    const me = await fetchMe();
    expect(me.authenticated).toBe(true);
    expect(me.user?.githubLogin).toBe("alice");
  });

  it("logout clears session and resets cached token", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    } as any);

    const res = await logout();
    expect(res.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/auth/logout",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("fetchInstallations calls /api/installations", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          id: "inst-1",
          installationGithubId: "123",
          accountLogin: "acme",
          repositoryCount: 5,
        },
      ],
    } as any);

    const items = await fetchInstallations();
    expect(items).toHaveLength(1);
    expect(items[0].accountLogin).toBe("acme");
  });

  it("fetchRepositories serializes query parameters correctly", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        repositories: [],
        total: 0,
        page: 2,
        perPage: 10,
        totalPages: 0,
      }),
    } as any);

    await fetchRepositories({
      installationId: "999",
      search: "lens",
      page: 2,
      perPage: 10,
      sortBy: "name",
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/repositories?installationId=999&search=lens&page=2&perPage=10&sortBy=name",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("fetchDashboardOverview calls /api/dashboard/overview", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        totalRepositories: 3,
        totalReviews: 12,
        statusCounts: { SUCCEEDED: 11, FAILED: 1 },
        findingsBySeverity: {
          CRITICAL: 1,
          HIGH: 2,
          MEDIUM: 3,
          LOW: 4,
          INFO: 0,
        },
        recentReviews: [],
      }),
    } as any);

    const overview = await fetchDashboardOverview();
    expect(overview.totalRepositories).toBe(3);
    expect(overview.findingsBySeverity.CRITICAL).toBe(1);
  });

  it("fetchReviews serializes status and repositoryId", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        reviews: [],
        total: 0,
        page: 1,
        perPage: 12,
        totalPages: 0,
      }),
    } as any);

    await fetchReviews({
      repositoryId: "repo-123",
      status: "SUCCEEDED",
      page: 1,
      perPage: 12,
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/reviews?repositoryId=repo-123&status=SUCCEEDED&page=1&perPage=12",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("fetchReviewDetail, fetchReviewFindings, and fetchReviewExecution call respective endpoints", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "rev-1", prNumber: 42 }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ reviewId: "rev-1", findings: [] }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ available: true, status: "COMPLETED" }),
      } as any);

    const detail = await fetchReviewDetail("rev-1");
    expect(detail.prNumber).toBe(42);

    const findings = await fetchReviewFindings("rev-1");
    expect(findings.findings).toEqual([]);

    const execution = await fetchReviewExecution("rev-1");
    expect(execution.available).toBe(true);

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "/api/reviews/rev-1",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "/api/reviews/rev-1/findings",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      "/api/reviews/rev-1/execution",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("apiFetch throws on non-ok responses with parsed message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: "Forbidden access" }),
    } as any);

    await expect(apiFetch("/api/forbidden")).rejects.toThrow(
      "Forbidden access",
    );
  });
});
