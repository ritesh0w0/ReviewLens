import { describe, expect, it } from "vitest";
import {
  PullRequestDiffPipeline,
  StaleRevisionError,
  ClosedPullRequestError,
  PipelineResourceLimitError,
  IncompleteRetrievalError,
  MAX_CHANGED_FILES_LIMIT,
} from "../pipeline/pull-request-diff-pipeline.js";
import { FakeGitHubPullRequestClient } from "../github/fake-client.js";
import type { GitHubChangedFileItem } from "../github/pull-request-client.js";

describe("PR Metadata & Changed-File Retrieval (Step 1)", () => {
  const defaultHeadSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const defaultBaseSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const defaultPrNumber = 101;

  function makeFile(
    filename: string,
    overrides: Partial<GitHubChangedFileItem> = {},
  ): GitHubChangedFileItem {
    return {
      filename,
      status: "modified",
      additions: 1,
      deletions: 0,
      changes: 1,
      patch: "@@ -0,0 +1,1 @@\n+line",
      ...overrides,
    };
  }

  it("retrieves a 1-file PR successfully", async () => {
    const file = makeFile("src/index.ts");
    const fakeGithub = new FakeGitHubPullRequestClient({
      prInfo: {
        state: "open",
        headSha: defaultHeadSha,
        baseSha: defaultBaseSha,
        prNumber: defaultPrNumber,
        changedFilesCount: 1,
      },
      reviews: [],
      files: [file],
    });

    const pipeline = new PullRequestDiffPipeline(fakeGithub);
    const prepared = await pipeline.prepare({
      owner: "test-owner",
      repo: "test-repo",
      prNumber: defaultPrNumber,
      expectedHeadSha: defaultHeadSha,
      expectedBaseSha: defaultBaseSha,
    });

    expect(prepared.completeness.receivedFileCount).toBe(1);
    expect(prepared.completeness.expectedFileCount).toBe(1);
    expect(prepared.completeness.paginationComplete).toBe(true);
    expect(prepared.completeness.revisionVerified).toBe(true);
    expect(prepared.files).toHaveLength(1);
    expect(prepared.files[0]!.metadata.path).toBe("src/index.ts");
    expect(prepared.files[0]!.parseStatus).toBe("parsed");
  });

  it("retrieves exactly 100 files in a single page", async () => {
    const files = Array.from({ length: 100 }, (_, i) =>
      makeFile(`src/file_${i}.ts`),
    );

    const fakeGithub = new FakeGitHubPullRequestClient({
      prInfo: {
        state: "open",
        headSha: defaultHeadSha,
        baseSha: defaultBaseSha,
        prNumber: defaultPrNumber,
        changedFilesCount: 100,
      },
      reviews: [],
      files,
    });

    const pipeline = new PullRequestDiffPipeline(fakeGithub);
    const prepared = await pipeline.prepare({
      owner: "test-owner",
      repo: "test-repo",
      prNumber: defaultPrNumber,
      expectedHeadSha: defaultHeadSha,
      expectedBaseSha: defaultBaseSha,
    });

    expect(prepared.completeness.receivedFileCount).toBe(100);
    expect(prepared.files).toHaveLength(100);
    // Page 1 had 100 items; then it fetches page 2 which returns 0 items to confirm termination
    expect(fakeGithub.filesCalls[0]?.perPage).toBe(100);
    expect(fakeGithub.filesCalls[0]?.page).toBe(1);
  });

  it("paginates across multiple pages for 101 files requesting per_page: 100", async () => {
    const files = Array.from({ length: 101 }, (_, i) =>
      makeFile(`src/file_${i}.ts`),
    );

    const fakeGithub = new FakeGitHubPullRequestClient({
      prInfo: {
        state: "open",
        headSha: defaultHeadSha,
        baseSha: defaultBaseSha,
        prNumber: defaultPrNumber,
        changedFilesCount: 101,
      },
      reviews: [],
      files,
    });

    const pipeline = new PullRequestDiffPipeline(fakeGithub);
    const prepared = await pipeline.prepare({
      owner: "test-owner",
      repo: "test-repo",
      prNumber: defaultPrNumber,
      expectedHeadSha: defaultHeadSha,
      expectedBaseSha: defaultBaseSha,
    });

    expect(prepared.completeness.receivedFileCount).toBe(101);
    expect(prepared.files).toHaveLength(101);
    expect(fakeGithub.filesCalls.length).toBe(2);
    expect(fakeGithub.filesCalls[0]).toEqual({ page: 1, perPage: 100 });
    expect(fakeGithub.filesCalls[1]).toEqual({ page: 2, perPage: 100 });
  });

  it("rejects PR reporting more than 3,000 files with EXCEEDS_FILE_LIMIT", async () => {
    const fakeGithub = new FakeGitHubPullRequestClient({
      prInfo: {
        state: "open",
        headSha: defaultHeadSha,
        baseSha: defaultBaseSha,
        prNumber: defaultPrNumber,
        changedFilesCount: MAX_CHANGED_FILES_LIMIT + 1,
      },
      reviews: [],
      files: [],
    });

    const pipeline = new PullRequestDiffPipeline(fakeGithub);
    await expect(
      pipeline.prepare({
        owner: "test-owner",
        repo: "test-repo",
        prNumber: defaultPrNumber,
        expectedHeadSha: defaultHeadSha,
        expectedBaseSha: defaultBaseSha,
      }),
    ).rejects.toThrow(PipelineResourceLimitError);
  });

  it("rejects incomplete file snapshot when fetched count does not match expected metadata count", async () => {
    const files = [makeFile("src/only-one.ts")];

    const fakeGithub = new FakeGitHubPullRequestClient({
      prInfo: {
        state: "open",
        headSha: defaultHeadSha,
        baseSha: defaultBaseSha,
        prNumber: defaultPrNumber,
        changedFilesCount: 5, // Metadata says 5 files changed, but only 1 returned
      },
      reviews: [],
      files,
    });

    const pipeline = new PullRequestDiffPipeline(fakeGithub);
    await expect(
      pipeline.prepare({
        owner: "test-owner",
        repo: "test-repo",
        prNumber: defaultPrNumber,
        expectedHeadSha: defaultHeadSha,
        expectedBaseSha: defaultBaseSha,
      }),
    ).rejects.toThrow(IncompleteRetrievalError);
  });

  it("detects and records diagnostic for duplicate file records in pagination", async () => {
    const file1 = makeFile("src/dup.ts");
    const file2 = makeFile("src/dup.ts");

    const fakeGithub = new FakeGitHubPullRequestClient({
      prInfo: {
        state: "open",
        headSha: defaultHeadSha,
        baseSha: defaultBaseSha,
        prNumber: defaultPrNumber,
        changedFilesCount: 2,
      },
      reviews: [],
      files: [file1, file2],
    });

    const pipeline = new PullRequestDiffPipeline(fakeGithub);
    const prepared = await pipeline.prepare({
      owner: "test-owner",
      repo: "test-repo",
      prNumber: defaultPrNumber,
      expectedHeadSha: defaultHeadSha,
      expectedBaseSha: defaultBaseSha,
    });

    const dupDiag = prepared.diagnostics.find(
      (d) => d.code === "DUPLICATE_FILE_ENTRY",
    );
    expect(dupDiag).toBeDefined();
    expect(dupDiag?.path).toBe("src/dup.ts");
  });

  it("rejects with StaleRevisionError when initial headSha does not match expected", async () => {
    const fakeGithub = new FakeGitHubPullRequestClient({
      prInfo: {
        state: "open",
        headSha: "newerSha00000000000000000000000000000000",
        baseSha: defaultBaseSha,
        prNumber: defaultPrNumber,
        changedFilesCount: 1,
      },
      reviews: [],
      files: [makeFile("src/a.ts")],
    });

    const pipeline = new PullRequestDiffPipeline(fakeGithub);
    await expect(
      pipeline.prepare({
        owner: "test-owner",
        repo: "test-repo",
        prNumber: defaultPrNumber,
        expectedHeadSha: defaultHeadSha,
        expectedBaseSha: defaultBaseSha,
      }),
    ).rejects.toThrow(StaleRevisionError);
  });

  it("rejects with StaleRevisionError when initial baseSha does not match expected", async () => {
    const fakeGithub = new FakeGitHubPullRequestClient({
      prInfo: {
        state: "open",
        headSha: defaultHeadSha,
        baseSha: "newerBaseSha00000000000000000000000000000",
        prNumber: defaultPrNumber,
        changedFilesCount: 1,
      },
      reviews: [],
      files: [makeFile("src/a.ts")],
    });

    const pipeline = new PullRequestDiffPipeline(fakeGithub);
    await expect(
      pipeline.prepare({
        owner: "test-owner",
        repo: "test-repo",
        prNumber: defaultPrNumber,
        expectedHeadSha: defaultHeadSha,
        expectedBaseSha: defaultBaseSha,
      }),
    ).rejects.toThrow(StaleRevisionError);
  });

  it("rejects with StaleRevisionError when head SHA advances during retrieval (re-fetch validation)", async () => {
    let callCount = 0;
    const fakeGithub = new FakeGitHubPullRequestClient({
      prInfo: {
        state: "open",
        headSha: defaultHeadSha,
        baseSha: defaultBaseSha,
        prNumber: defaultPrNumber,
        changedFilesCount: 1,
      },
      reviews: [],
      files: [makeFile("src/a.ts")],
      onGetPullRequest: () => {
        callCount++;
        if (callCount === 1) {
          // Initial check: matches expected
          return {
            state: "open",
            headSha: defaultHeadSha,
            baseSha: defaultBaseSha,
            prNumber: defaultPrNumber,
            changedFilesCount: 1,
          };
        } else {
          // Re-fetch post check: developer pushed new commit during retrieval!
          return {
            state: "open",
            headSha: "newerHeadPushedDuringRetrieval0000000000",
            baseSha: defaultBaseSha,
            prNumber: defaultPrNumber,
            changedFilesCount: 1,
          };
        }
      },
    });

    const pipeline = new PullRequestDiffPipeline(fakeGithub);
    await expect(
      pipeline.prepare({
        owner: "test-owner",
        repo: "test-repo",
        prNumber: defaultPrNumber,
        expectedHeadSha: defaultHeadSha,
        expectedBaseSha: defaultBaseSha,
      }),
    ).rejects.toThrow(StaleRevisionError);
  });

  it("rejects with ClosedPullRequestError when PR is closed or merged", async () => {
    const fakeGithub = new FakeGitHubPullRequestClient({
      prInfo: {
        state: "closed",
        headSha: defaultHeadSha,
        baseSha: defaultBaseSha,
        prNumber: defaultPrNumber,
        changedFilesCount: 1,
        merged: true,
      },
      reviews: [],
      files: [makeFile("src/a.ts")],
    });

    const pipeline = new PullRequestDiffPipeline(fakeGithub);
    await expect(
      pipeline.prepare({
        owner: "test-owner",
        repo: "test-repo",
        prNumber: defaultPrNumber,
        expectedHeadSha: defaultHeadSha,
        expectedBaseSha: defaultBaseSha,
      }),
    ).rejects.toThrow(ClosedPullRequestError);
  });

  it("rejects when aggregate patch size exceeds 10 MiB limit", async () => {
    // 3 files whose patches sum to > 10 MiB
    const largeChunk = "a".repeat(4 * 1024 * 1024); // 4 MiB
    const files = [
      makeFile("src/chunk1.ts", { patch: `@@ -0,0 +1,1 @@\n+${largeChunk}` }),
      makeFile("src/chunk2.ts", { patch: `@@ -0,0 +1,1 @@\n+${largeChunk}` }),
      makeFile("src/chunk3.ts", { patch: `@@ -0,0 +1,1 @@\n+${largeChunk}` }),
    ];

    const fakeGithub = new FakeGitHubPullRequestClient({
      prInfo: {
        state: "open",
        headSha: defaultHeadSha,
        baseSha: defaultBaseSha,
        prNumber: defaultPrNumber,
        changedFilesCount: 3,
      },
      reviews: [],
      files,
    });

    const pipeline = new PullRequestDiffPipeline(fakeGithub);
    await expect(
      pipeline.prepare({
        owner: "test-owner",
        repo: "test-repo",
        prNumber: defaultPrNumber,
        expectedHeadSha: defaultHeadSha,
        expectedBaseSha: defaultBaseSha,
      }),
    ).rejects.toThrow(PipelineResourceLimitError);
  });

  it("marks individual file patch_unavailable when patch is missing (e.g. binary file)", async () => {
    const file = makeFile("assets/image.png", { patch: undefined });

    const fakeGithub = new FakeGitHubPullRequestClient({
      prInfo: {
        state: "open",
        headSha: defaultHeadSha,
        baseSha: defaultBaseSha,
        prNumber: defaultPrNumber,
        changedFilesCount: 1,
      },
      reviews: [],
      files: [file],
    });

    const pipeline = new PullRequestDiffPipeline(fakeGithub);
    const prepared = await pipeline.prepare({
      owner: "test-owner",
      repo: "test-repo",
      prNumber: defaultPrNumber,
      expectedHeadSha: defaultHeadSha,
      expectedBaseSha: defaultBaseSha,
    });

    expect(prepared.files).toHaveLength(1);
    expect(prepared.files[0]!.parseStatus).toBe("patch_unavailable");
    expect(prepared.files[0]!.locations).toBeUndefined();
  });
});
