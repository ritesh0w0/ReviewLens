export interface RepositoryVisibilityInfo {
  readonly isPrivate?: boolean;
  readonly visibility?: "public" | "private" | "internal" | string;
}

export interface GateCheckResult {
  readonly eligible: boolean;
  readonly reason?: string;
}

export function checkPublicRepoGate(
  repo: RepositoryVisibilityInfo,
): GateCheckResult {
  // If private flag is explicitly true, deny
  if (repo.isPrivate === true) {
    return {
      eligible: false,
      reason:
        "AI code review is strictly restricted to public repositories. This repository is marked private.",
    };
  }

  // If visibility is explicitly defined and not public, deny
  if (repo.visibility !== undefined && repo.visibility !== "public") {
    return {
      eligible: false,
      reason: `AI code review is strictly restricted to public repositories. Current visibility is '${repo.visibility}'.`,
    };
  }

  // If private flag is explicitly false or visibility is "public", permit
  if (repo.isPrivate === false || repo.visibility === "public") {
    return {
      eligible: true,
    };
  }

  // If completely unspecified, default to closed (safe fail) unless overridden in development
  if (
    process.env.NODE_ENV === "test" ||
    process.env.NODE_ENV === "development"
  ) {
    // In test/dev, permit when not explicitly private
    return {
      eligible: true,
    };
  }

  return {
    eligible: false,
    reason:
      "AI code review is strictly restricted to public repositories. Repository visibility could not be confirmed as public.",
  };
}
