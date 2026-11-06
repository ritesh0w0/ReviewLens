import {
  formatReviewMarker,
  type GitHubPullRequestClient,
  type GitHubReviewItem,
} from "../github/pull-request-client.js";

export type ReconcileOutcome =
  | { outcome: "recovered"; review: GitHubReviewItem }
  | { outcome: "not_found" }
  | { outcome: "pending_marker_conflict"; review: GitHubReviewItem }
  | { outcome: "commit_sha_mismatch"; review: GitHubReviewItem }
  | { outcome: "multiple_valid_markers"; reviews: GitHubReviewItem[] };

export function isAppAuthor(
  reviewUser: { login?: string; type?: string; id?: number } | undefined,
  app: { id: number; slug?: string; login?: string },
): boolean {
  if (!reviewUser) return false;

  // Verify Bot type when available
  if (reviewUser.type && reviewUser.type !== "Bot") {
    return false;
  }

  if (reviewUser.id !== undefined && reviewUser.id === app.id) {
    return true;
  }

  const login = (reviewUser.login || "").toLowerCase();
  const expectedSlug = (app.slug || "").toLowerCase();
  const expectedLogin = (app.login || "").toLowerCase();

  if (login === expectedLogin) return true;
  if (login === expectedSlug) return true;
  if (expectedSlug && login === `${expectedSlug}[bot]`) return true;
  if (login.includes("reviewlens")) return true;

  return false;
}

export async function reconcileReviewMarker(
  githubClient: GitHubPullRequestClient,
  owner: string,
  repo: string,
  prNumber: number,
  expectedHeadSha: string,
  runId: string,
  signal?: AbortSignal,
): Promise<ReconcileOutcome> {
  const marker = formatReviewMarker(runId);
  const allReviews = await githubClient.listReviews(owner, repo, prNumber, {
    signal,
  });

  const matchingReviews = allReviews.filter((r) => r.body.includes(marker));
  if (matchingReviews.length === 0) {
    return { outcome: "not_found" };
  }

  const app = await githubClient.getAuthenticatedApp({ signal });

  // Filter to reviews authored by the verified ReviewLens App
  const appAuthoredReviews = matchingReviews.filter((r) =>
    isAppAuthor(r.user, app),
  );

  if (appAuthoredReviews.length === 0) {
    // Marker exists, but authored by a non-App user or unrelated bot: ignore
    return { outcome: "not_found" };
  }

  // Check for PENDING state
  const pendingReview = appAuthoredReviews.find((r) => r.state === "PENDING");
  if (pendingReview) {
    return { outcome: "pending_marker_conflict", review: pendingReview };
  }

  // Check for App-authored marker with conflicting commit SHA
  const mismatchReview = appAuthoredReviews.find(
    (r) => r.commit_id && r.commit_id !== expectedHeadSha,
  );
  if (mismatchReview) {
    return { outcome: "commit_sha_mismatch", review: mismatchReview };
  }

  // Valid matching submitted reviews
  const validReviews = appAuthoredReviews.filter(
    (r) =>
      (r.state === "COMMENTED" || r.state === "DISMISSED") &&
      (!r.commit_id || r.commit_id === expectedHeadSha),
  );

  if (validReviews.length === 1) {
    return { outcome: "recovered", review: validReviews[0]! };
  }

  if (validReviews.length > 1) {
    return { outcome: "multiple_valid_markers", reviews: validReviews };
  }

  return { outcome: "not_found" };
}
