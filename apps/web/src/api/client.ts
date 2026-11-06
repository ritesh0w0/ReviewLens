import type {
  AuthMeResponse,
  InstallationItem,
  RepositoriesResponse,
  DashboardOverviewResponse,
  ReviewsResponse,
  ReviewDetailResponse,
  ReviewFindingsResponse,
  AIExecutionTelemetryResponse,
} from "./types.js";

let cachedCsrfToken: string | null = null;

export const API_BASE =
  (import.meta.env.BASE_URL ?? "/").replace(/\/+$/, "") + "/api";

export async function fetchCsrfToken(): Promise<string> {
  if (cachedCsrfToken) return cachedCsrfToken;
  try {
    const res = await fetch(`${API_BASE}/auth/csrf`, {
      credentials: "include",
    });
    if (res.ok) {
      const data = await res.json();
      cachedCsrfToken = data.csrfToken;
      return data.csrfToken;
    }
  } catch {
    // Ignore fallback
  }
  return "";
}

export async function apiFetch<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);

  // For state-changing requests, ensure CSRF token is attached
  if (
    ["POST", "PUT", "DELETE", "PATCH"].includes(
      options.method?.toUpperCase() ?? "",
    )
  ) {
    const csrf = await fetchCsrfToken();
    if (csrf) {
      headers.set("x-csrf-token", csrf);
    }
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: "include",
  });

  if (!res.ok) {
    let errorMsg = `API request failed with status ${res.status}`;
    try {
      const body = await res.json();
      if (body.error) errorMsg = body.error;
    } catch {
      // Non-json error
    }
    const err = new Error(errorMsg);
    (err as any).status = res.status;
    throw err;
  }

  return res.json() as Promise<T>;
}

export async function fetchMe(): Promise<AuthMeResponse> {
  return apiFetch<AuthMeResponse>(`${API_BASE}/auth/me`);
}

export async function logout(): Promise<{ success: boolean }> {
  const res = await apiFetch<{ success: boolean }>(`${API_BASE}/auth/logout`, {
    method: "POST",
  });
  cachedCsrfToken = null;
  return res;
}

export async function fetchInstallations(): Promise<InstallationItem[]> {
  return apiFetch<InstallationItem[]>(`${API_BASE}/installations`);
}

export async function fetchRepositories(
  params: {
    installationId?: string;
    search?: string;
    page?: number;
    perPage?: number;
    sortBy?: "name" | "recent";
  } = {},
): Promise<RepositoriesResponse> {
  const query = new URLSearchParams();
  if (params.installationId) query.set("installationId", params.installationId);
  if (params.search) query.set("search", params.search);
  if (params.page) query.set("page", String(params.page));
  if (params.perPage) query.set("perPage", String(params.perPage));
  if (params.sortBy) query.set("sortBy", params.sortBy);

  return apiFetch<RepositoriesResponse>(
    `${API_BASE}/repositories?${query.toString()}`,
  );
}

export async function fetchDashboardOverview(): Promise<DashboardOverviewResponse> {
  return apiFetch<DashboardOverviewResponse>(`${API_BASE}/dashboard/overview`);
}

export async function fetchReviews(
  params: {
    repositoryId?: string;
    installationId?: string;
    status?: string;
    page?: number;
    perPage?: number;
  } = {},
): Promise<ReviewsResponse> {
  const query = new URLSearchParams();
  if (params.repositoryId) query.set("repositoryId", params.repositoryId);
  if (params.installationId) query.set("installationId", params.installationId);
  if (params.status) query.set("status", params.status);
  if (params.page) query.set("page", String(params.page));
  if (params.perPage) query.set("perPage", String(params.perPage));

  return apiFetch<ReviewsResponse>(`${API_BASE}/reviews?${query.toString()}`);
}

export async function fetchReviewDetail(
  id: string,
): Promise<ReviewDetailResponse> {
  return apiFetch<ReviewDetailResponse>(`${API_BASE}/reviews/${id}`);
}

export async function fetchReviewFindings(
  id: string,
): Promise<ReviewFindingsResponse> {
  return apiFetch<ReviewFindingsResponse>(`${API_BASE}/reviews/${id}/findings`);
}

export async function fetchReviewExecution(
  id: string,
): Promise<AIExecutionTelemetryResponse> {
  return apiFetch<AIExecutionTelemetryResponse>(
    `${API_BASE}/reviews/${id}/execution`,
  );
}
