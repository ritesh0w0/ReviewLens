import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  InstallationStatus,
  ReviewStatus,
} from "../generated/prisma/client.js";
import { processReviewJob } from "../workers/review-processor.js";
import { FakeGitHubPullRequestClient } from "../github/fake-client.js";
import { createMockPrismaClient } from "./mock-prisma.js";

describe("M3 Deterministic Review Pipeline End-to-End Test", () => {
  const headSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const baseSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const prNumber = 505;

  it("orchestrates the entire M3 review workflow: retrieval, base config, filtering, parsing, deterministic rules, evidence validation, fingerprinting, ranking, capping, grouping, and GitHub review publishing", async () => {
    const prisma = createMockPrismaClient();

    // 1. Setup DB state
    const inst = await prisma.installation.upsert({
      where: { githubInstallationId: 1000n },
      create: {
        githubInstallationId: 1000n,
        accountLogin: "acme-corp",
        accountType: "Organization",
        status: InstallationStatus.ACTIVE,
      },
      update: {},
    });

    const repo = await prisma.repository.upsert({
      where: { githubRepoId: 2000n },
      create: {
        githubRepoId: 2000n,
        fullName: "acme-corp/service-api",
        enabled: true,
        installationId: inst.id,
      },
      update: {},
    });

    const runId = `run-${randomUUID()}`;
    const claimToken = randomUUID();

    const run = await prisma.reviewRun.create({
      data: {
        id: runId,
        repositoryId: repo.id,
        prNumber,
        headSha,
        baseSha,
        status: ReviewStatus.RUNNING,
        claimToken,
        attemptCount: 1,
      },
    });

    // 2. Define repository-owned configuration in .reviewlens.yml
    // - path filtering: exclude vendor/**
    // - review cap: max_inline_comments: 1 (to test cap suppression)
    // - rules:
    //   1) forbid_regex: forbid 'console.debug' and 'eval('
    //   2) require_companion: src/**/*.ts must have src/**/*.test.ts
    //   3) max_pr_size: max_total_changes: 20
    const configYaml = [
      "version: 1",
      "paths:",
      "  include:",
      "    - 'src/**'",
      "  exclude:",
      "    - 'vendor/**'",
      "review:",
      "  max_inline_comments: 1",
      "rules:",
      "  - id: no-console-debug",
      "    type: forbid_regex",
      "    enabled: true",
      "    pattern: 'console\\.debug'",
      "    message: 'Remove debug logging before merging'",
      "    severity: high",
      "  - id: no-eval",
      "    type: forbid_regex",
      "    enabled: true",
      "    pattern: 'eval\\('",
      "    message: 'eval() is prohibited for security reasons'",
      "    severity: critical",
      "  - id: require-unit-test",
      "    type: require_companion",
      "    enabled: true",
      "    source_suffix: '.service.ts'",
      "    companion_suffix: '.test.ts'",
      "    severity: medium",
      "  - id: pr-size-limit",
      "    type: max_pr_size",
      "    enabled: true",
      "    max_total_changes: 20",
      "    severity: low",
    ].join("\n");

    // 3. Define multi-file PR:
    // File 1 (src/handler.service.ts):
    // Line 4: has `console.debug`
    // Line 5: has `eval(`
    // Triggers companion rule (no src/handler.test.ts companion)
    const handlerPatch = [
      "@@ -1,4 +1,6 @@",
      " export function handle() {",
      "   const a = 1;",
      "+  console.debug('evaluating');",
      "+  const res = eval('a + 1');",
      "   return res;",
      " }",
    ].join("\n");

    // File 2 (src/utils.service.ts):
    // Line 2: has another `console.debug` (triggers forbid_regex, but inline cap = 1 should suppress this group)
    // Has a companion file: src/utils.test.ts (which is present in files!)
    const utilsPatch = [
      "@@ -1,2 +1,3 @@",
      " export function util() {",
      "+  console.debug('util');",
      " }",
    ].join("\n");

    // File 3 (src/utils.test.ts): companion for File 2
    const utilsTestPatch = [
      "@@ -0,0 +1,4 @@",
      "+import { util } from './utils.service';",
      "+test('util', () => {",
      "+  util();",
      "+});",
    ].join("\n");

    // File 4 (vendor/third-party.js):
    // In vendor/**, excluded by path filter! Should be ignored completely.
    const vendorPatch = [
      "@@ -0,0 +1,2 @@",
      "+eval('malicious');",
      "+console.debug('vendor');",
    ].join("\n");

    const fakeGithub = new FakeGitHubPullRequestClient({
      prInfo: {
        state: "open",
        headSha,
        baseSha,
        prNumber,
        changedFilesCount: 4,
      },
      reviews: [],
      files: [
        {
          filename: "src/handler.service.ts",
          status: "modified",
          additions: 2,
          deletions: 0,
          changes: 2,
          patch: handlerPatch,
        },
        {
          filename: "src/utils.service.ts",
          status: "modified",
          additions: 1,
          deletions: 0,
          changes: 1,
          patch: utilsPatch,
        },
        {
          filename: "src/utils.test.ts",
          status: "added",
          additions: 4,
          deletions: 0,
          changes: 4,
          patch: utilsTestPatch,
        },
        {
          filename: "vendor/third-party.js",
          status: "added",
          additions: 2,
          deletions: 0,
          changes: 2,
          patch: vendorPatch,
        },
      ],
      contents: {
        [`.reviewlens.yml@${baseSha}`]: configYaml,
      },
    });

    // 4. Run the review worker job
    const result = await processReviewJob(prisma, run.id, {
      claimToken,
      attempt: 1,
      githubClient: fakeGithub,
    });

    // 5. Verify ReviewProcessResult
    expect(result.status).toBe(ReviewStatus.SUCCEEDED);
    expect(result.githubReviewId).toBeDefined();

    // 6. Verify batched GitHub review was posted
    expect(fakeGithub.batchedReviewsCreated).toHaveLength(1);
    const publishedReview = fakeGithub.batchedReviewsCreated[0]!;

    expect(publishedReview.input.commitSha).toBe(headSha);
    expect(publishedReview.input.event).toBe("COMMENT");

    // Inline comment checks:
    // With max_inline_comments: 1, exactly 1 inline group must be published!
    expect(publishedReview.input.comments).toHaveLength(1);

    const inlineComment = publishedReview.input.comments![0]!;
    expect(inlineComment.path).toBe("src/handler.service.ts");
    expect(inlineComment.line).toBe(4);
    expect(inlineComment.body).toContain("CRITICAL");
    expect(inlineComment.body).toContain("eval() is prohibited");

    // Summary checks:
    // The summary must contain:
    // 1) File-level finding: src/handler.service.ts missing companion src/handler.test.ts
    // 2) Statistics:
    //    - Total findings detected: 4
    //      (eval at handler:4, console.debug at handler:3, console.debug at utils:2, missing companion for handler)
    //    - Inline comment groups posted: 1
    //    - Findings omitted due to comment limit: 2 (2 anchor groups omitted)
    // 3) Exactly the ReviewRun marker
    expect(publishedReview.input.body).toContain("File Level Findings");
    expect(publishedReview.input.body).toContain("src/handler.service.ts");
    expect(publishedReview.input.body).toContain(
      "Required companion file missing from pull request",
    );
    expect(publishedReview.input.body).toContain(
      "Inline comment groups posted: 1",
    );
    expect(publishedReview.input.body).toContain(
      `<!-- reviewlens:run:${runId} -->`,
    );

    // Verify vendor file was excluded completely (no vendor findings)
    expect(publishedReview.input.body).not.toContain("vendor/third-party.js");

    // 7. Verify Database ReviewRun record was updated to SUCCEEDED
    const updatedRun = await prisma.reviewRun.findUnique({
      where: { id: run.id },
    });
    expect(updatedRun?.status).toBe(ReviewStatus.SUCCEEDED);
    expect(updatedRun?.filesTotal).toBe(4);
    expect(updatedRun?.filesReviewed).toBe(3); // 3 eligible files (vendor excluded)
    expect(updatedRun?.githubReviewId).toBe(BigInt(result.githubReviewId!));
    expect(updatedRun?.finishedAt).toBeInstanceOf(Date);
  });
});
