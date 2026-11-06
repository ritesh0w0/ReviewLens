import { describe, expect, it } from "vitest";
import {
  PullRequestDiffPipeline,
  StaleRevisionError,
} from "../pipeline/pull-request-diff-pipeline.js";
import { FakeGitHubPullRequestClient } from "../github/fake-client.js";
import type { GitHubChangedFileItem } from "../github/pull-request-client.js";

describe("End-to-End M2 Pipeline Test (Part 11.5)", () => {
  const expectedHeadSha = "3333333333333333333333333333333333333333";
  const expectedBaseSha = "4444444444444444444444444444444444444444";
  const prNumber = 777;
  const owner = "reviewlens-org";
  const repo = "sample-app";

  it("orchestrates the complete M2 pipeline: pagination, base config, filtering, parsing, and mapping", async () => {
    // 1. Setup base-commit configuration
    const configYaml = [
      "version: 1",
      "paths:",
      "  include:",
      "    - 'src/**'",
      "  exclude:",
      "    - 'src/**/*.generated.ts'",
      "    - 'dist/**'",
      "    - 'vendor/**'",
    ].join("\n");

    // 2. Multi-hunk patch for an included file
    const multiHunkPatch = [
      "@@ -10,3 +10,4 @@",
      " function calc(a, b) {",
      "-  return a + b;",
      "+  const res = a + b;",
      "+  return res;",
      " }",
      "@@ -30,2 +31,2 @@",
      " const max = 100;",
      "-const min = 0;",
      "+const min = 1;",
    ].join("\n");

    // 3. Create 102 files across 2 pages:
    // File 1: included file with multi-hunk patch
    const includedFile: GitHubChangedFileItem = {
      filename: "src/calculator.ts",
      status: "modified",
      additions: 3,
      deletions: 2,
      changes: 5,
      patch: multiHunkPatch,
    };

    // File 2: excluded by pattern (dist/**)
    const excludedFile: GitHubChangedFileItem = {
      filename: "dist/bundle.js",
      status: "added",
      additions: 50,
      deletions: 0,
      changes: 50,
      patch: "@@ -0,0 +1,1 @@\n+bundledContent",
    };

    // File 3: renamed file from vendor/ (excluded by old path) to src/lib.ts
    const renamedExcludedFile: GitHubChangedFileItem = {
      filename: "src/lib.ts",
      previous_filename: "vendor/old-lib.ts",
      status: "renamed",
      additions: 1,
      deletions: 1,
      changes: 2,
      patch: "@@ -1,1 +1,1 @@\n-old\n+new",
    };

    // Remaining files to exceed 100 items (102 files total)
    const paddingFiles: GitHubChangedFileItem[] = Array.from(
      { length: 99 },
      (_, i) => ({
        filename: `src/modules/module_${i}.ts`,
        status: "added",
        additions: 1,
        deletions: 0,
        changes: 1,
        patch: "@@ -0,0 +1,1 @@\n+export const x = 1;",
      }),
    );

    const allFiles = [
      includedFile,
      excludedFile,
      renamedExcludedFile,
      ...paddingFiles,
    ];
    expect(allFiles).toHaveLength(102);

    const fakeGithub = new FakeGitHubPullRequestClient({
      prInfo: {
        state: "open",
        headSha: expectedHeadSha,
        baseSha: expectedBaseSha,
        prNumber,
        changedFilesCount: 102,
        baseRef: "main",
        headRef: "feature-calc",
      },
      reviews: [],
      files: allFiles,
      contents: {
        [`.reviewlens.yml@${expectedBaseSha}`]: configYaml,
      },
    });

    const pipeline = new PullRequestDiffPipeline(fakeGithub);
    const prepared = await pipeline.prepare({
      owner,
      repo,
      prNumber,
      expectedHeadSha,
      expectedBaseSha,
    });

    // 1. Revision identity is preserved
    expect(prepared.pullRequest.headSha).toBe(expectedHeadSha);
    expect(prepared.pullRequest.baseSha).toBe(expectedBaseSha);
    expect(prepared.pullRequest.number).toBe(prNumber);

    // 2. Configuration was read at the base SHA
    expect(fakeGithub.contentsCalls).toHaveLength(1);
    expect(fakeGithub.contentsCalls[0]).toEqual({
      path: ".reviewlens.yml",
      ref: expectedBaseSha,
    });
    expect(prepared.configuration.status).toBe("loaded");
    expect(prepared.configuration.baseSha).toBe(expectedBaseSha);

    // 3. All pages were handled requesting per_page: 100
    expect(fakeGithub.filesCalls.length).toBe(2);
    expect(fakeGithub.filesCalls[0]).toEqual({ page: 1, perPage: 100 });
    expect(fakeGithub.filesCalls[1]).toEqual({ page: 2, perPage: 100 });
    expect(prepared.completeness.receivedFileCount).toBe(102);
    expect(prepared.completeness.expectedFileCount).toBe(102);
    expect(prepared.completeness.paginationComplete).toBe(true);
    expect(prepared.completeness.revisionVerified).toBe(true);

    // 4. Excluded files were NOT parsed and have no locations
    const distFile = prepared.files.find(
      (f) => f.metadata.path === "dist/bundle.js",
    );
    expect(distFile).toBeDefined();
    expect(distFile!.filterDecision.included).toBe(false);
    expect(distFile!.filterDecision.reason).toBe("matched_exclude");
    expect(distFile!.parseStatus).toBe("excluded");
    expect(distFile!.diff).toBeUndefined();
    expect(distFile!.locations).toBeUndefined();

    // Renamed file from vendor/ was excluded because previousPath matched vendor/**
    const renamedFile = prepared.files.find(
      (f) => f.metadata.path === "src/lib.ts",
    );
    expect(renamedFile).toBeDefined();
    expect(renamedFile!.filterDecision.included).toBe(false);
    expect(renamedFile!.filterDecision.reason).toBe("matched_exclude");
    expect(renamedFile!.parseStatus).toBe("excluded");

    // 5. Included file was parsed correctly with matching additions/deletions
    const calcFile = prepared.files.find(
      (f) => f.metadata.path === "src/calculator.ts",
    );
    expect(calcFile).toBeDefined();
    expect(calcFile!.filterDecision.included).toBe(true);
    expect(calcFile!.parseStatus).toBe("parsed");
    expect(calcFile!.diff).toBeDefined();
    expect(calcFile!.diff!.hunks).toHaveLength(2);
    expect(calcFile!.diff!.additions).toBe(3);
    expect(calcFile!.diff!.deletions).toBe(2);

    // 6. All locations have correct line/side mappings and commitSha binding
    expect(calcFile!.locations).toBeDefined();
    const locMap = calcFile!.locations!;

    // Hunk 1 addition on line 11
    const addLoc = locMap.find("src/calculator.ts", "RIGHT", 11);
    expect(addLoc).toBeDefined();
    expect(addLoc!.side).toBe("RIGHT");
    expect(addLoc!.line).toBe(11);
    expect(addLoc!.kind).toBe("addition");
    expect(addLoc!.isChanged).toBe(true);
    expect(addLoc!.commitSha).toBe(expectedHeadSha);

    // Hunk 1 deletion on line 11 (LEFT side)
    const delLoc = locMap.find("src/calculator.ts", "LEFT", 11);
    expect(delLoc).toBeDefined();
    expect(delLoc!.side).toBe("LEFT");
    expect(delLoc!.line).toBe(11);
    expect(delLoc!.kind).toBe("deletion");
    expect(delLoc!.isChanged).toBe(true);
    expect(delLoc!.commitSha).toBe(expectedHeadSha);

    // Hunk 1 context on line 10
    const ctxLoc = locMap.find("src/calculator.ts", "RIGHT", 10);
    expect(ctxLoc).toBeDefined();
    expect(ctxLoc!.isChanged).toBe(false);

    // 7. Raw patch content is not persisted on prepared files
    for (const f of prepared.files) {
      expect(f.metadata.patch).toBeUndefined();
    }

    // 8. ZERO GitHub reviews were published!
    expect(fakeGithub.reviewsCreated).toHaveLength(0);
  });

  it("rejects snapshot when PR head changes during retrieval (stale-run check)", async () => {
    let checkCount = 0;
    const fakeGithub = new FakeGitHubPullRequestClient({
      prInfo: {
        state: "open",
        headSha: expectedHeadSha,
        baseSha: expectedBaseSha,
        prNumber,
        changedFilesCount: 1,
      },
      reviews: [],
      files: [
        {
          filename: "src/a.ts",
          status: "modified",
          additions: 1,
          deletions: 0,
          changes: 1,
          patch: "@@ -0,0 +1,1 @@\n+line",
        },
      ],
      onGetPullRequest: () => {
        checkCount++;
        if (checkCount === 1) {
          // Initial check: matches expected
          return {
            state: "open",
            headSha: expectedHeadSha,
            baseSha: expectedBaseSha,
            prNumber,
            changedFilesCount: 1,
          };
        } else {
          // Re-fetch post check: head changed!
          return {
            state: "open",
            headSha: "9999999999999999999999999999999999999999",
            baseSha: expectedBaseSha,
            prNumber,
            changedFilesCount: 1,
          };
        }
      },
    });

    const pipeline = new PullRequestDiffPipeline(fakeGithub);
    await expect(
      pipeline.prepare({
        owner,
        repo,
        prNumber,
        expectedHeadSha,
        expectedBaseSha,
      }),
    ).rejects.toThrow(StaleRevisionError);

    // ZERO reviews published
    expect(fakeGithub.reviewsCreated).toHaveLength(0);
  });
});
