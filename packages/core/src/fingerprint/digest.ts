import { createHash } from "node:crypto";
import { toCanonicalJson } from "./canonical.js";
import type { CandidateFinding, FindingOrigin } from "../types/findings.js";
import type { RuleConfigItem } from "../types/rules.js";

export const FINGERPRINT_VERSION = 1;

export function computeConfigDigest(config: RuleConfigItem): string {
  let semanticPayload: unknown;

  if (config.type === "forbid_regex") {
    semanticPayload = {
      ruleType: config.type,
      pattern: config.pattern,
      case_sensitive: config.case_sensitive ?? true,
      ruleVersion: 1,
    };
  } else if (config.type === "require_companion") {
    semanticPayload = {
      ruleType: config.type,
      source_suffix: config.source_suffix,
      companion_suffix: config.companion_suffix,
      ruleVersion: 1,
    };
  } else if (config.type === "max_pr_size") {
    semanticPayload = {
      ruleType: config.type,
      max_files: config.max_files,
      max_total_changes: config.max_total_changes,
      ruleVersion: 1,
    };
  } else {
    semanticPayload = {
      ruleType: (config as { type: string }).type,
      ruleVersion: 1,
    };
  }

  const canonical = toCanonicalJson(semanticPayload);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function computeFindingFingerprint(
  candidate: CandidateFinding,
  repoIdentifier: string,
  prNumber: number,
  origin: FindingOrigin,
  occurrenceDiscriminator: number = 0,
): string {
  const { code, scope, primaryEvidence } = candidate;

  let stableEvidenceIdentity: unknown;

  if (primaryEvidence.kind === "code_line") {
    stableEvidenceIdentity = {
      kind: "code_line",
      path: primaryEvidence.path,
      lineHash: primaryEvidence.lineHash,
      matchRange: primaryEvidence.matchRange
        ? {
            start: primaryEvidence.matchRange.start,
            end: primaryEvidence.matchRange.end,
          }
        : undefined,
      occurrence: occurrenceDiscriminator,
    };
  } else if (primaryEvidence.kind === "file_relationship") {
    stableEvidenceIdentity = {
      kind: "file_relationship",
      relation: primaryEvidence.relation,
      sourcePath: primaryEvidence.sourcePath,
      expectedPath: primaryEvidence.expectedPath,
    };
  } else if (primaryEvidence.kind === "pull_request_metric") {
    stableEvidenceIdentity = {
      kind: "pull_request_metric",
      metric: primaryEvidence.metric,
      threshold: primaryEvidence.threshold,
    };
  } else {
    stableEvidenceIdentity = {
      kind: "unknown",
    };
  }

  const canonicalPayload = toCanonicalJson({
    fingerprintVersion: FINGERPRINT_VERSION,
    repository: repoIdentifier,
    prNumber,
    origin: {
      kind: origin.kind,
      ruleId:
        origin.kind === "deterministic_rule"
          ? origin.ruleId
          : origin.detectorId,
      ruleType: origin.kind === "deterministic_rule" ? origin.ruleType : "ai",
      configDigest:
        origin.kind === "deterministic_rule" ? origin.configDigest : undefined,
    },
    code,
    scope,
    evidence: stableEvidenceIdentity,
  });

  return createHash("sha256").update(canonicalPayload, "utf8").digest("hex");
}
