import type { GitHubPullRequestClient } from "../../github/pull-request-client.js";
import { CONTEXT_LIMITS } from "../config.js";
import { scanAndSanitizeContent } from "../security/secret-scanner.js";
import { sanitizeUnicode } from "../security/unicode-sanitizer.js";

export interface BoundedFileContent {
  readonly path: string;
  readonly content?: string;
  readonly truncated: boolean;
  readonly skippedReason?: string;
  readonly sizeBytes: number;
}

export interface BoundedSourceFetchResult {
  readonly files: ReadonlyMap<string, BoundedFileContent>;
  readonly totalBytes: number;
  readonly skippedCount: number;
}

export async function fetchBoundedSources(
  client: GitHubPullRequestClient,
  owner: string,
  repo: string,
  headSha: string,
  filePaths: readonly string[],
  signal?: AbortSignal,
): Promise<BoundedSourceFetchResult> {
  const result = new Map<string, BoundedFileContent>();
  let aggregateBytes = 0;
  let skippedCount = 0;

  // Enforce max 30 files limit
  const targetPaths = filePaths.slice(
    0,
    CONTEXT_LIMITS.MAX_CONTEXT_FILES_PER_PR,
  );
  if (filePaths.length > CONTEXT_LIMITS.MAX_CONTEXT_FILES_PER_PR) {
    skippedCount += filePaths.length - CONTEXT_LIMITS.MAX_CONTEXT_FILES_PER_PR;
  }

  for (const path of targetPaths) {
    if (signal?.aborted) {
      break;
    }

    try {
      const rawContent = await client.getFileContent(
        owner,
        repo,
        path,
        headSha,
        { signal },
      );

      if (rawContent === null) {
        result.set(path, {
          path,
          truncated: false,
          skippedReason: "File not found or deleted on head commit",
          sizeBytes: 0,
        });
        continue;
      }

      const byteLength = Buffer.byteLength(rawContent, "utf8");

      // Check single file limit (256 KiB)
      if (byteLength > CONTEXT_LIMITS.MAX_SINGLE_FILE_BYTES) {
        skippedCount++;
        result.set(path, {
          path,
          truncated: true,
          skippedReason: `File size (${byteLength} bytes) exceeds maximum single file limit (${CONTEXT_LIMITS.MAX_SINGLE_FILE_BYTES} bytes)`,
          sizeBytes: byteLength,
        });
        continue;
      }

      // Check aggregate budget limit (2 MiB)
      if (
        aggregateBytes + byteLength >
        CONTEXT_LIMITS.MAX_AGGREGATE_SOURCE_BYTES
      ) {
        skippedCount++;
        result.set(path, {
          path,
          truncated: true,
          skippedReason: `Aggregate source size exceeds limit (${CONTEXT_LIMITS.MAX_AGGREGATE_SOURCE_BYTES} bytes)`,
          sizeBytes: byteLength,
        });
        continue;
      }

      // Secret scan and Unicode sanitize
      const secretCheck = scanAndSanitizeContent(rawContent);
      if (secretCheck.action === "exclude_file") {
        skippedCount++;
        result.set(path, {
          path,
          truncated: false,
          skippedReason:
            secretCheck.reason ?? "File excluded due to detected private keys",
          sizeBytes: byteLength,
        });
        continue;
      }

      const cleanContent = sanitizeUnicode(secretCheck.content);
      aggregateBytes += byteLength;

      result.set(path, {
        path,
        content: cleanContent,
        truncated: false,
        sizeBytes: byteLength,
      });
    } catch (err: unknown) {
      skippedCount++;
      result.set(path, {
        path,
        truncated: false,
        skippedReason: `Failed to fetch file content: ${err instanceof Error ? err.message : String(err)}`,
        sizeBytes: 0,
      });
    }
  }

  return {
    files: result,
    totalBytes: aggregateBytes,
    skippedCount,
  };
}

/**
 * Extracts a window of lines around the target line numbers from full source text.
 */
export function extractLineWindow(
  content: string,
  targetLines: readonly number[],
  windowSize: number = CONTEXT_LIMITS.CONTEXT_WINDOW_LINES,
): string {
  if (targetLines.length === 0 || !content) {
    return "";
  }

  const allLines = content.split("\n");
  const total = allLines.length;

  const linesToInclude = new Set<number>();
  for (const line of targetLines) {
    const start = Math.max(1, line - windowSize);
    const end = Math.min(total, line + windowSize);
    for (let l = start; l <= end; l++) {
      linesToInclude.add(l);
    }
  }

  const sorted = Array.from(linesToInclude).sort((a, b) => a - b);
  const result: string[] = [];
  let prevLine = -1;

  for (const lineNum of sorted) {
    if (prevLine !== -1 && lineNum > prevLine + 1) {
      result.push(`... [lines ${prevLine + 1} to ${lineNum - 1} omitted] ...`);
    }
    const idx = lineNum - 1;
    result.push(`${lineNum}: ${allLines[idx] ?? ""}`);
    prevLine = lineNum;
  }

  return result.join("\n");
}
