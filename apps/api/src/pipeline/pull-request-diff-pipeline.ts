import type {
  GitHubChangedFileItem,
  GitHubPullRequestClient,
} from "../github/pull-request-client.js";
import { loadRepositoryConfig } from "./config-loader.js";
import { PathFilter } from "./path-filter.js";
import { parseUnifiedPatch } from "./unified-diff-parser.js";
import { buildFileLocationIndex } from "./commentable-line-mapper.js";
import type {
  ChangedFileMetadata,
  PipelineDiagnostic,
  PreparedFile,
  PreparedReviewInput,
  PreparePullRequestInput,
} from "./types.js";

export const MAX_CHANGED_FILES_LIMIT = 3000;
export const MAX_AGGREGATE_DIFF_BYTES = 10 * 1024 * 1024; // 10 MiB aggregate

export class StaleRevisionError extends Error {
  public readonly code = "STALE_PR_REVISION";
  constructor(message: string) {
    super(message);
    this.name = "StaleRevisionError";
  }
}

export class ClosedPullRequestError extends Error {
  public readonly code = "PR_CLOSED";
  constructor(message: string) {
    super(message);
    this.name = "ClosedPullRequestError";
  }
}

export class PipelineResourceLimitError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PipelineResourceLimitError";
    this.code = code;
  }
}

export class IncompleteRetrievalError extends Error {
  public readonly code = "INCOMPLETE_CHANGED_FILES";
  constructor(message: string) {
    super(message);
    this.name = "IncompleteRetrievalError";
  }
}

export class PullRequestDiffPipeline {
  constructor(private readonly githubClient: GitHubPullRequestClient) {}

  async prepare(input: PreparePullRequestInput): Promise<PreparedReviewInput> {
    const { owner, repo, prNumber, expectedHeadSha, expectedBaseSha, signal } =
      input;

    const diagnostics: PipelineDiagnostic[] = [];

    // 1. Initial PR metadata retrieval
    const prMeta = await this.githubClient.getPullRequest(
      owner,
      repo,
      prNumber,
      { signal },
    );

    // 2. Validate PR open state
    if (prMeta.state !== "open") {
      throw new ClosedPullRequestError(
        `Pull request #${prNumber} is ${prMeta.state}. Only open pull requests are eligible for review.`,
      );
    }

    // 3. Initial revision verification against expected ReviewRun SHAs
    if (prMeta.headSha !== expectedHeadSha) {
      throw new StaleRevisionError(
        `Pull request head SHA changed: expected ${expectedHeadSha.slice(0, 7)}, current is ${prMeta.headSha.slice(0, 7)}`,
      );
    }

    if (prMeta.baseSha !== expectedBaseSha) {
      throw new StaleRevisionError(
        `Pull request base SHA changed: expected ${expectedBaseSha.slice(0, 7)}, current is ${prMeta.baseSha.slice(0, 7)}`,
      );
    }

    const expectedFilesCount = prMeta.changedFilesCount ?? 0;

    // 4. API limit check (3,000 files ceiling)
    if (expectedFilesCount > MAX_CHANGED_FILES_LIMIT) {
      throw new PipelineResourceLimitError(
        "EXCEEDS_FILE_LIMIT",
        `Pull request #${prNumber} reports ${expectedFilesCount} changed files, which exceeds the limit of ${MAX_CHANGED_FILES_LIMIT}`,
      );
    }

    // 5. Load repository configuration from exact base SHA
    const effectiveConfig = await loadRepositoryConfig(
      this.githubClient,
      owner,
      repo,
      expectedBaseSha,
      { signal },
    );

    for (const warning of effectiveConfig.warnings) {
      diagnostics.push({
        code: "CONFIG_WARNING",
        message: warning,
        severity: "warning",
      });
    }

    const filter = new PathFilter(effectiveConfig.config);

    // 6. Paginate changed files
    const allFetchedFiles: GitHubChangedFileItem[] = [];
    const seenPaths = new Set<string>();
    let page = 1;
    let paginationComplete = false;

    while (true) {
      if (signal?.aborted) {
        throw new Error("Pipeline aborted during pagination");
      }

      const pageFiles = await this.githubClient.getPullRequestFiles(
        owner,
        repo,
        prNumber,
        {
          signal,
          page,
          perPage: 100,
        },
      );

      if (pageFiles.length === 0) {
        paginationComplete = true;
        break;
      }

      for (const file of pageFiles) {
        if (seenPaths.has(file.filename)) {
          diagnostics.push({
            code: "DUPLICATE_FILE_ENTRY",
            message: `Duplicate file record received for ${file.filename}`,
            path: file.filename,
            severity: "warning",
          });
        } else {
          seenPaths.add(file.filename);
        }
        allFetchedFiles.push(file);

        if (allFetchedFiles.length > MAX_CHANGED_FILES_LIMIT) {
          throw new PipelineResourceLimitError(
            "EXCEEDS_FILE_LIMIT",
            `Fetched files count exceeded the maximum limit of ${MAX_CHANGED_FILES_LIMIT}`,
          );
        }
      }

      if (pageFiles.length < 100) {
        paginationComplete = true;
        break;
      }

      page++;
    }

    // 7. Verify pagination completeness
    if (
      expectedFilesCount > 0 &&
      allFetchedFiles.length !== expectedFilesCount
    ) {
      throw new IncompleteRetrievalError(
        `Changed files count mismatch: expected ${expectedFilesCount} from PR metadata, but retrieved ${allFetchedFiles.length}`,
      );
    }

    // 8. Process files: filter, bound aggregate diff bytes, parse patches & map locations
    let aggregatePatchBytes = 0;
    const preparedFiles: PreparedFile[] = [];

    for (const file of allFetchedFiles) {
      const metadata: ChangedFileMetadata = {
        path: file.filename,
        previousPath: file.previous_filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
        sha: file.sha,
        patch: file.patch,
      };

      // Apply path filter before parsing
      const filterDecision = filter.evaluate({
        path: file.filename,
        previousPath: file.previous_filename,
        status: file.status,
      });

      if (!filterDecision.included) {
        preparedFiles.push({
          metadata: { ...metadata, patch: undefined }, // Release raw patch
          filterDecision,
          parseStatus: "excluded",
        });
        continue;
      }

      // Check aggregate patch size
      if (file.patch) {
        const patchBytes = Buffer.byteLength(file.patch, "utf8");
        aggregatePatchBytes += patchBytes;

        if (aggregatePatchBytes > MAX_AGGREGATE_DIFF_BYTES) {
          throw new PipelineResourceLimitError(
            "EXCEEDS_AGGREGATE_DIFF_LIMIT",
            `Aggregate patch bytes (${aggregatePatchBytes}) exceeded maximum limit of ${MAX_AGGREGATE_DIFF_BYTES} bytes`,
          );
        }
      }

      // Parse patch
      const diff = parseUnifiedPatch(file.patch, {
        path: file.filename,
        previousPath: file.previous_filename,
        additions: file.additions,
        deletions: file.deletions,
      });

      if (diff.diagnosticCode) {
        diagnostics.push({
          code: diff.diagnosticCode,
          message: `File ${file.filename} parse outcome: ${diff.parseStatus} (${diff.diagnosticCode})`,
          path: file.filename,
          severity: diff.parseStatus === "parsed" ? "info" : "warning",
        });
      }

      // Build location index if successfully parsed
      let locations = undefined;
      if (diff.parseStatus === "parsed") {
        const mappingResult = buildFileLocationIndex(diff, expectedHeadSha);
        if (mappingResult.error) {
          diagnostics.push({
            code: "LOCATION_MAPPING_ERROR",
            message: mappingResult.error,
            path: file.filename,
            severity: "error",
          });
        } else {
          locations = mappingResult.locations;
        }
      }

      preparedFiles.push({
        metadata: { ...metadata, patch: undefined }, // Transient patch released from memory
        filterDecision,
        parseStatus: diff.parseStatus,
        diff,
        locations,
      });
    }

    // 9. Re-fetch PR metadata for final revision verification
    const postPrMeta = await this.githubClient.getPullRequest(
      owner,
      repo,
      prNumber,
      { signal },
    );

    if (
      postPrMeta.headSha !== expectedHeadSha ||
      postPrMeta.baseSha !== expectedBaseSha ||
      postPrMeta.state !== "open"
    ) {
      throw new StaleRevisionError(
        `Pull request revision changed during diff processing (head: ${postPrMeta.headSha.slice(0, 7)}, base: ${postPrMeta.baseSha.slice(0, 7)}, state: ${postPrMeta.state})`,
      );
    }

    return {
      repository: {
        owner,
        name: repo,
        isPrivate: postPrMeta.isRepoPrivate ?? prMeta.isRepoPrivate,
        visibility: postPrMeta.repoVisibility ?? prMeta.repoVisibility,
      },
      pullRequest: {
        number: prNumber,
        state: postPrMeta.state,
        isDraft: postPrMeta.isDraft ?? false,
        baseSha: postPrMeta.baseSha,
        baseRef: postPrMeta.baseRef ?? "main",
        headSha: postPrMeta.headSha,
        headRef: postPrMeta.headRef ?? "feature",
        changedFilesCount: allFetchedFiles.length,
      },
      configuration: effectiveConfig,
      completeness: {
        expectedFileCount: expectedFilesCount,
        receivedFileCount: allFetchedFiles.length,
        paginationComplete,
        revisionVerified: true,
      },
      files: preparedFiles,
      diagnostics,
    };
  }
}
