import { describe, expect, it } from "vitest";
import {
  validateFindingEvidence,
  type CandidateFinding,
  type CodeLineEvidence,
  type RuleContext,
} from "@reviewlens/core";
import { createHash } from "node:crypto";

describe("Evidence Validator (M3 Step 3)", () => {
  const headSha = "1111111111111111111111111111111111111111";
  const baseSha = "2222222222222222222222222222222222222222";
  const lineContent = "const x = 10;";
  const lineHash = createHash("sha256")
    .update(lineContent, "utf8")
    .digest("hex");

  const validContext: RuleContext = {
    repository: { owner: "org", name: "repo" },
    pullRequest: { number: 42, headSha, baseSha },
    files: [
      {
        path: "src/valid.ts",
        status: "modified",
        isEligible: true,
        parseStatus: "parsed",
        additions: [
          {
            line: 12,
            content: lineContent,
            hunkIndex: 0,
            commitSha: headSha,
          },
        ],
        metrics: { additions: 1, deletions: 0, changes: 1 },
      },
      {
        path: "src/excluded.ts",
        status: "modified",
        isEligible: false,
        parseStatus: "excluded",
        additions: [],
        metrics: { additions: 1, deletions: 0, changes: 1 },
      },
      {
        path: "src/unparsed.ts",
        status: "modified",
        isEligible: true,
        parseStatus: "patch_unavailable",
        additions: [],
        metrics: { additions: 0, deletions: 0, changes: 0 },
      },
      {
        path: "src/service.ts",
        status: "added",
        isEligible: true,
        parseStatus: "parsed",
        additions: [],
        metrics: { additions: 10, deletions: 0, changes: 10 },
      },
      {
        path: "src/with-companion.ts",
        status: "added",
        isEligible: true,
        parseStatus: "parsed",
        additions: [],
        metrics: { additions: 10, deletions: 0, changes: 10 },
      },
      {
        path: "src/with-companion.test.ts",
        status: "added",
        isEligible: true,
        parseStatus: "parsed",
        additions: [],
        metrics: { additions: 10, deletions: 0, changes: 10 },
      },
    ],
    metrics: {
      changedFiles: 6,
      additions: 32,
      deletions: 0,
      totalChanges: 32,
      completenessVerified: true,
    },
  };

  it("validates line evidence successfully when all invariants hold", () => {
    const candidate: CandidateFinding = {
      schemaVersion: 1,
      code: "FORBIDDEN_PATTERN",
      title: "Title",
      message: "Message",
      severity: "medium",
      scope: "line",
      primaryEvidence: {
        kind: "code_line",
        path: "src/valid.ts",
        side: "RIGHT",
        line: 12,
        commitSha: headSha,
        lineHash,
        hunkIndex: 0,
        matchRange: { start: 0, end: 5 },
      },
    };

    const res = validateFindingEvidence(candidate, validContext);
    expect(res.valid).toBe(true);
  });

  it("rejects mismatch between scope and evidence kind", () => {
    const candidate: CandidateFinding = {
      schemaVersion: 1,
      code: "TEST",
      title: "Title",
      message: "Message",
      severity: "medium",
      scope: "line",
      primaryEvidence: {
        kind: "file_relationship" as unknown as "code_line",
        relation: "companion_missing_from_pr",
        sourcePath: "src/valid.ts",
        expectedPath: "src/valid.test.ts",
        companionPresentInPr: false,
      } as unknown as CodeLineEvidence,
    };

    const res = validateFindingEvidence(candidate, validContext);
    expect(res.valid).toBe(false);
    expect(res.code).toBe("SCOPE_EVIDENCE_MISMATCH");
  });

  it("rejects commit SHA mismatch", () => {
    const candidate: CandidateFinding = {
      schemaVersion: 1,
      code: "FORBIDDEN_PATTERN",
      title: "Title",
      message: "Message",
      severity: "medium",
      scope: "line",
      primaryEvidence: {
        kind: "code_line",
        path: "src/valid.ts",
        side: "RIGHT",
        line: 12,
        commitSha: "9999999999999999999999999999999999999999", // Wrong commit SHA!
        lineHash,
        hunkIndex: 0,
      },
    };

    const res = validateFindingEvidence(candidate, validContext);
    expect(res.valid).toBe(false);
    expect(res.code).toBe("COMMIT_SHA_MISMATCH");
  });

  it("rejects file not in snapshot", () => {
    const candidate: CandidateFinding = {
      schemaVersion: 1,
      code: "FORBIDDEN_PATTERN",
      title: "Title",
      message: "Message",
      severity: "medium",
      scope: "line",
      primaryEvidence: {
        kind: "code_line",
        path: "src/ghost.ts", // Non-existent!
        side: "RIGHT",
        line: 1,
        commitSha: headSha,
        lineHash,
        hunkIndex: 0,
      },
    };

    const res = validateFindingEvidence(candidate, validContext);
    expect(res.valid).toBe(false);
    expect(res.code).toBe("FILE_NOT_IN_SNAPSHOT");
  });

  it("rejects file excluded by path filter", () => {
    const candidate: CandidateFinding = {
      schemaVersion: 1,
      code: "FORBIDDEN_PATTERN",
      title: "Title",
      message: "Message",
      severity: "medium",
      scope: "line",
      primaryEvidence: {
        kind: "code_line",
        path: "src/excluded.ts",
        side: "RIGHT",
        line: 1,
        commitSha: headSha,
        lineHash,
        hunkIndex: 0,
      },
    };

    const res = validateFindingEvidence(candidate, validContext);
    expect(res.valid).toBe(false);
    expect(res.code).toBe("FILE_EXCLUDED");
  });

  it("rejects line content hash mismatch", () => {
    const candidate: CandidateFinding = {
      schemaVersion: 1,
      code: "FORBIDDEN_PATTERN",
      title: "Title",
      message: "Message",
      severity: "medium",
      scope: "line",
      primaryEvidence: {
        kind: "code_line",
        path: "src/valid.ts",
        side: "RIGHT",
        line: 12,
        commitSha: headSha,
        lineHash:
          "wrong_sha256_hash_here_0000000000000000000000000000000000000",
        hunkIndex: 0,
      },
    };

    const res = validateFindingEvidence(candidate, validContext);
    expect(res.valid).toBe(false);
    expect(res.code).toBe("LINE_HASH_MISMATCH");
  });

  it("rejects out-of-bounds match range", () => {
    const candidate: CandidateFinding = {
      schemaVersion: 1,
      code: "FORBIDDEN_PATTERN",
      title: "Title",
      message: "Message",
      severity: "medium",
      scope: "line",
      primaryEvidence: {
        kind: "code_line",
        path: "src/valid.ts",
        side: "RIGHT",
        line: 12,
        commitSha: headSha,
        lineHash,
        hunkIndex: 0,
        matchRange: { start: 0, end: 999 }, // Out of bounds for line of length 13!
      },
    };

    const res = validateFindingEvidence(candidate, validContext);
    expect(res.valid).toBe(false);
    expect(res.code).toBe("INVALID_MATCH_RANGE");
  });

  it("validates file relationship evidence when companion is genuinely absent", () => {
    const candidate: CandidateFinding = {
      schemaVersion: 1,
      code: "COMPANION_MISSING",
      title: "Title",
      message: "Message",
      severity: "low",
      scope: "file",
      primaryEvidence: {
        kind: "file_relationship",
        relation: "companion_missing_from_pr",
        sourcePath: "src/service.ts",
        expectedPath: "src/service.test.ts",
        companionPresentInPr: false,
      },
    };

    const res = validateFindingEvidence(candidate, validContext);
    expect(res.valid).toBe(true);
  });

  it("rejects file relationship evidence if companion is actually present in PR", () => {
    const candidate: CandidateFinding = {
      schemaVersion: 1,
      code: "COMPANION_MISSING",
      title: "Title",
      message: "Message",
      severity: "low",
      scope: "file",
      primaryEvidence: {
        kind: "file_relationship",
        relation: "companion_missing_from_pr",
        sourcePath: "src/with-companion.ts",
        expectedPath: "src/with-companion.test.ts", // Actually present!
        companionPresentInPr: false,
      },
    };

    const res = validateFindingEvidence(candidate, validContext);
    expect(res.valid).toBe(false);
    expect(res.code).toBe("COMPANION_ACTUALLY_PRESENT");
  });

  it("validates PR metric evidence when recalculated value exceeds threshold", () => {
    const candidate: CandidateFinding = {
      schemaVersion: 1,
      code: "PR_SIZE_EXCEEDED",
      title: "Title",
      message: "Message",
      severity: "low",
      scope: "pull_request",
      primaryEvidence: {
        kind: "pull_request_metric",
        metric: "changed_files",
        actual: 6,
        threshold: 5,
        comparator: "greater_than",
      },
    };

    const res = validateFindingEvidence(candidate, validContext);
    expect(res.valid).toBe(true);
  });

  it("rejects PR metric evidence when recalculated value does not match claimed value", () => {
    const candidate: CandidateFinding = {
      schemaVersion: 1,
      code: "PR_SIZE_EXCEEDED",
      title: "Title",
      message: "Message",
      severity: "low",
      scope: "pull_request",
      primaryEvidence: {
        kind: "pull_request_metric",
        metric: "changed_files",
        actual: 99, // Lie: actual is 6!
        threshold: 5,
        comparator: "greater_than",
      },
    };

    const res = validateFindingEvidence(candidate, validContext);
    expect(res.valid).toBe(false);
    expect(res.code).toBe("METRIC_RECALCULATION_MISMATCH");
  });

  it("rejects PR metric evidence when threshold is not strictly exceeded", () => {
    const candidate: CandidateFinding = {
      schemaVersion: 1,
      code: "PR_SIZE_EXCEEDED",
      title: "Title",
      message: "Message",
      severity: "low",
      scope: "pull_request",
      primaryEvidence: {
        kind: "pull_request_metric",
        metric: "changed_files",
        actual: 6,
        threshold: 6, // 6 is not > 6!
        comparator: "greater_than",
      },
    };

    const res = validateFindingEvidence(candidate, validContext);
    expect(res.valid).toBe(false);
    expect(res.code).toBe("THRESHOLD_NOT_EXCEEDED");
  });
});
