import { describe, expect, it } from "vitest";
import {
  computeConfigDigest,
  computeFindingFingerprint,
  deduplicateFindings,
  ConflictingFingerprintError,
  FINGERPRINT_VERSION,
  type CandidateFinding,
  type CodeLineEvidence,
  type FindingOrigin,
  type ForbidRegexConfig,
  type ValidatedFinding,
} from "@reviewlens/core";

describe("Stable Finding Fingerprints & Deduplication (M3 Step 3)", () => {
  const repoId = "owner/repo";
  const prNumber = 42;

  const baseConfig: ForbidRegexConfig = {
    id: "no-console",
    type: "forbid_regex",
    enabled: true,
    pattern: "console\\.log",
    message: "Avoid console.log",
    severity: "medium",
  };

  const origin: FindingOrigin = {
    kind: "deterministic_rule",
    ruleId: baseConfig.id,
    ruleType: baseConfig.type,
    ruleVersion: 1,
    configDigest: computeConfigDigest(baseConfig),
  };

  const candidate: CandidateFinding = {
    schemaVersion: 1,
    code: "FORBIDDEN_PATTERN",
    title: "Forbidden pattern detected",
    message: "Avoid console.log",
    severity: "medium",
    scope: "line",
    primaryEvidence: {
      kind: "code_line",
      path: "src/app.ts",
      side: "RIGHT",
      line: 25,
      commitSha: "1111111111111111111111111111111111111111",
      lineHash: "hash_of_line_content_here",
      hunkIndex: 0,
    },
  };

  it("yields identical fingerprint for identical finding and inputs", () => {
    const fp1 = computeFindingFingerprint(
      candidate,
      repoId,
      prNumber,
      origin,
      0,
    );
    const fp2 = computeFindingFingerprint(
      candidate,
      repoId,
      prNumber,
      origin,
      0,
    );
    expect(fp1).toBe(fp2);
    expect(FINGERPRINT_VERSION).toBe(1);
  });

  it("changing human message alone does NOT change fingerprint", () => {
    const fp1 = computeFindingFingerprint(
      candidate,
      repoId,
      prNumber,
      origin,
      0,
    );
    const modifiedCandidate = {
      ...candidate,
      message: "Completely different human readable explanation",
    };
    const fp2 = computeFindingFingerprint(
      modifiedCandidate,
      repoId,
      prNumber,
      origin,
      0,
    );
    expect(fp1).toBe(fp2);
  });

  it("changing severity alone does NOT change fingerprint", () => {
    const fp1 = computeFindingFingerprint(
      candidate,
      repoId,
      prNumber,
      origin,
      0,
    );
    const modifiedCandidate: CandidateFinding = {
      ...candidate,
      severity: "critical",
    };
    const fp2 = computeFindingFingerprint(
      modifiedCandidate,
      repoId,
      prNumber,
      origin,
      0,
    );
    expect(fp1).toBe(fp2);
  });

  it("shifting absolute line number alone does NOT change fingerprint", () => {
    const fp1 = computeFindingFingerprint(
      candidate,
      repoId,
      prNumber,
      origin,
      0,
    );
    const lineEvidence = candidate.primaryEvidence as CodeLineEvidence;
    const shiftedCandidate: CandidateFinding = {
      ...candidate,
      primaryEvidence: {
        ...lineEvidence,
        line: 999, // Line number shifted due to edits elsewhere in file!
      },
    };
    const fp2 = computeFindingFingerprint(
      shiftedCandidate,
      repoId,
      prNumber,
      origin,
      0,
    );
    expect(fp1).toBe(fp2);
  });

  it("changing rule ID changes fingerprint", () => {
    const fp1 = computeFindingFingerprint(
      candidate,
      repoId,
      prNumber,
      origin,
      0,
    );
    const diffOrigin: FindingOrigin = {
      ...origin,
      ruleId: "other-rule-id",
    };
    const fp2 = computeFindingFingerprint(
      candidate,
      repoId,
      prNumber,
      diffOrigin,
      0,
    );
    expect(fp1).not.toBe(fp2);
  });

  it("changing semantic config digest changes fingerprint", () => {
    const fp1 = computeFindingFingerprint(
      candidate,
      repoId,
      prNumber,
      origin,
      0,
    );
    const modifiedConfig: ForbidRegexConfig = {
      ...baseConfig,
      pattern: "debugger", // Different pattern!
    };
    const diffOrigin: FindingOrigin = {
      ...origin,
      configDigest: computeConfigDigest(modifiedConfig),
    };
    const fp2 = computeFindingFingerprint(
      candidate,
      repoId,
      prNumber,
      diffOrigin,
      0,
    );
    expect(fp1).not.toBe(fp2);
  });

  it("distinguishes repeated identical lines in same file via occurrence discriminator", () => {
    const fpOccur0 = computeFindingFingerprint(
      candidate,
      repoId,
      prNumber,
      origin,
      0,
    );
    const fpOccur1 = computeFindingFingerprint(
      candidate,
      repoId,
      prNumber,
      origin,
      1,
    );
    expect(fpOccur0).not.toBe(fpOccur1);
  });

  it("deduplication collapses identical duplicate findings", () => {
    const fp = computeFindingFingerprint(
      candidate,
      repoId,
      prNumber,
      origin,
      0,
    );
    const validated1: ValidatedFinding = {
      ...candidate,
      origin,
      fingerprint: fp,
      fingerprintVersion: 1,
    };
    const validated2: ValidatedFinding = {
      ...candidate,
      origin,
      fingerprint: fp,
      fingerprintVersion: 1,
    };

    const deduped = deduplicateFindings([validated1, validated2]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.fingerprint).toBe(fp);
  });

  it("deduplication rejects conflicting findings sharing the same fingerprint", () => {
    const fp = "shared_fingerprint_hash";
    const validated1: ValidatedFinding = {
      ...candidate,
      code: "CODE_A",
      origin,
      fingerprint: fp,
      fingerprintVersion: 1,
    };
    const validated2: ValidatedFinding = {
      ...candidate,
      code: "CODE_B", // Conflicting code!
      origin,
      fingerprint: fp,
      fingerprintVersion: 1,
    };

    expect(() => deduplicateFindings([validated1, validated2])).toThrow(
      ConflictingFingerprintError,
    );
  });
});
