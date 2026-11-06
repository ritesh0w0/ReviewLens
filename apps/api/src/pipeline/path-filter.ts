import picomatch from "picomatch";
import type { PathFilterDecision, ReviewLensConfig } from "./types.js";

export interface PathFilterTarget {
  path: string;
  previousPath?: string;
  status?: string;
}

export class PathFilter {
  private readonly includeMatchers: Array<{
    pattern: string;
    matcher: picomatch.Matcher;
  }> = [];

  private readonly excludeMatchers: Array<{
    pattern: string;
    matcher: picomatch.Matcher;
  }> = [];

  private readonly hasIncludeRules: boolean;

  constructor(config: ReviewLensConfig) {
    const includePatterns = config.paths?.include;
    const excludePatterns = config.paths?.exclude ?? [];

    this.hasIncludeRules =
      Array.isArray(includePatterns) && includePatterns.length > 0;

    if (this.hasIncludeRules && includePatterns) {
      for (const pattern of includePatterns) {
        this.includeMatchers.push({
          pattern,
          matcher: picomatch(pattern, { dot: true }),
        });
      }
    }

    for (const pattern of excludePatterns) {
      this.excludeMatchers.push({
        pattern,
        matcher: picomatch(pattern, { dot: true }),
      });
    }
  }

  evaluate(target: PathFilterTarget): PathFilterDecision {
    const { path, previousPath } = target;

    // 1. Evaluate exclude rules:
    // For a renamed file, exclusion is evaluated against BOTH old and new paths.
    // If either path matches an exclude pattern, exclusion always wins!
    for (const { pattern, matcher } of this.excludeMatchers) {
      if (matcher(path)) {
        return {
          path,
          previousPath,
          included: false,
          reason: "matched_exclude",
          matchedPattern: pattern,
        };
      }

      if (previousPath && matcher(previousPath)) {
        return {
          path,
          previousPath,
          included: false,
          reason: "matched_exclude",
          matchedPattern: pattern,
        };
      }
    }

    // 2. Evaluate include rules (against current path):
    if (this.hasIncludeRules) {
      for (const { pattern, matcher } of this.includeMatchers) {
        if (matcher(path)) {
          return {
            path,
            previousPath,
            included: true,
            reason: "matched_include",
            matchedPattern: pattern,
          };
        }
      }

      // Include patterns were specified, but none matched
      return {
        path,
        previousPath,
        included: false,
        reason: "no_include_match",
      };
    }

    // 3. Default include: include list is omitted, so all paths are eligible
    return {
      path,
      previousPath,
      included: true,
      reason: "default_include",
    };
  }
}
