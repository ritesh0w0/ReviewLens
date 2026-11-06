import { createHash } from "node:crypto";
import {
  computeFindingFingerprint,
  validateFindingEvidence,
  type CandidateFinding,
  type FindingOrigin,
  type RuleContext,
  type ValidatedFinding,
} from "@reviewlens/core";
import { sanitizeSecretOccurrencesInProse } from "../security/secret-scanner.js";
import { sanitizeUnicode } from "../security/unicode-sanitizer.js";
import { sanitizeMarkdown } from "../../review/payload-builder.js";
import type {
  AIChunkReviewRequest,
  AIChunkReviewResult,
  RawAICandidate,
} from "../types.js";

export const AI_DETECTOR_ID = "reviewlens-ai";
export const AI_DETECTOR_VERSION = "1.0";

export interface ValidationStageDiagnostic {
  readonly stage: number;
  readonly stageName: string;
  readonly passed: boolean;
  readonly error?: string;
}

export interface CandidateValidationOutcome {
  readonly candidate?: ValidatedFinding;
  readonly accepted: boolean;
  readonly diagnostics: readonly ValidationStageDiagnostic[];
  readonly rejectionReason?: string;
}

export interface ChunkValidationResult {
  readonly validatedFindings: readonly ValidatedFinding[];
  readonly totalCandidates: number;
  readonly acceptedCandidates: number;
  readonly rejectedCandidates: number;
  readonly diagnostics: readonly CandidateValidationOutcome[];
}

export function validateAIChunkFindings(
  request: AIChunkReviewRequest,
  result: AIChunkReviewResult,
  ruleContext: RuleContext,
  options?: {
    repoIdentifier?: string;
  },
): ChunkValidationResult {
  const repoIdentifier = options?.repoIdentifier ?? request.repositoryFullName;

  const validatedFindings: ValidatedFinding[] = [];
  const diagnostics: CandidateValidationOutcome[] = [];

  // STAGE 1: Completion validation
  if (result.status !== "success") {
    return {
      validatedFindings: [],
      totalCandidates: 0,
      acceptedCandidates: 0,
      rejectedCandidates: 0,
      diagnostics: [
        {
          accepted: false,
          diagnostics: [
            {
              stage: 1,
              stageName: "CompletionValidation",
              passed: false,
              error: `Chunk invocation ended with status: ${result.status} (${result.errorMessage ?? "no message"})`,
            },
          ],
          rejectionReason: `Completion status: ${result.status}`,
        },
      ],
    };
  }

  const rawCandidates = result.rawFindings;
  let accepted = 0;
  let rejected = 0;

  for (const raw of rawCandidates) {
    const outcome = validateSingleCandidate(
      raw,
      request,
      ruleContext,
      repoIdentifier,
    );

    diagnostics.push(outcome);

    if (outcome.accepted && outcome.candidate) {
      validatedFindings.push(outcome.candidate);
      accepted++;
    } else {
      rejected++;
    }
  }

  return {
    validatedFindings,
    totalCandidates: rawCandidates.length,
    acceptedCandidates: accepted,
    rejectedCandidates: rejected,
    diagnostics,
  };
}

function validateSingleCandidate(
  raw: RawAICandidate,
  request: AIChunkReviewRequest,
  ruleContext: RuleContext,
  repoIdentifier: string,
): CandidateValidationOutcome {
  const stages: ValidationStageDiagnostic[] = [];

  // Stage 1: Passed (completion verified at chunk level)
  stages.push({
    stage: 1,
    stageName: "CompletionValidation",
    passed: true,
  });

  // Stage 2: Schema validation (validate fields and constraints)
  if (
    !raw.file_path ||
    !raw.line ||
    raw.line < 1 ||
    !raw.side ||
    !raw.title ||
    !raw.message ||
    !raw.evidence_quote ||
    typeof raw.confidence !== "number" ||
    !Number.isFinite(raw.confidence) ||
    raw.confidence < 0 ||
    raw.confidence > 1
  ) {
    stages.push({
      stage: 2,
      stageName: "SchemaValidation",
      passed: false,
      error: "Missing or invalid candidate fields",
    });
    return {
      accepted: false,
      diagnostics: stages,
      rejectionReason: "Schema validation failed",
    };
  }
  stages.push({
    stage: 2,
    stageName: "SchemaValidation",
    passed: true,
  });

  // Stage 3: Path membership validation
  const matchingUnitFile = request.files.find((f) => f.path === raw.file_path);
  if (!matchingUnitFile) {
    stages.push({
      stage: 3,
      stageName: "PathMembershipValidation",
      passed: false,
      error: `File path '${raw.file_path}' is not part of this reviewed chunk`,
    });
    return {
      accepted: false,
      diagnostics: stages,
      rejectionReason: `File '${raw.file_path}' not in chunk files`,
    };
  }
  stages.push({
    stage: 3,
    stageName: "PathMembershipValidation",
    passed: true,
  });

  // Stage 4: Commentable line index validation
  const commentableLine = matchingUnitFile.commentableLines.find(
    (cl) => cl.line === raw.line && cl.side === raw.side,
  );
  if (!commentableLine) {
    stages.push({
      stage: 4,
      stageName: "CommentableLineValidation",
      passed: false,
      error: `Line ${raw.line} on ${raw.side} is not a commentable line in '${raw.file_path}'`,
    });
    return {
      accepted: false,
      diagnostics: stages,
      rejectionReason: `Line ${raw.line} (${raw.side}) is not commentable`,
    };
  }
  stages.push({
    stage: 4,
    stageName: "CommentableLineValidation",
    passed: true,
  });

  // Find line content in ruleContext for verbatim evidence validation
  const ruleFile = ruleContext.files.find((f) => f.path === raw.file_path);
  if (!ruleFile) {
    stages.push({
      stage: 4,
      stageName: "CommentableLineValidation",
      passed: false,
      error: `File '${raw.file_path}' not found in ruleContext`,
    });
    return {
      accepted: false,
      diagnostics: stages,
      rejectionReason: `File not in rule context`,
    };
  }

  const lineEntry =
    raw.side === "RIGHT"
      ? ruleFile.additions.find((a) => a.line === raw.line)
      : ruleFile.deletions?.find((d) => d.line === raw.line);

  if (!lineEntry) {
    stages.push({
      stage: 4,
      stageName: "CommentableLineValidation",
      passed: false,
      error: `Line content for line ${raw.line} (${raw.side}) missing from diff snapshot`,
    });
    return {
      accepted: false,
      diagnostics: stages,
      rejectionReason: `Line content missing from snapshot`,
    };
  }

  // Stage 5: Verbatim evidence quote validation (model-safe quote matches original or sanitized line)
  const quoteTrimmed = raw.evidence_quote.trim();
  const lineContentTrimmed = lineEntry.content.trim();
  const matchingSanitizedLine = matchingUnitFile.sanitizedLines?.find(
    (sl) => sl.line === raw.line && sl.side === raw.side,
  );
  const sanitizedLineContentTrimmed = matchingSanitizedLine?.content.trim();

  const quoteMatchesOriginal =
    lineContentTrimmed.includes(quoteTrimmed) ||
    quoteTrimmed.includes(lineContentTrimmed);

  const quoteMatchesSanitized =
    sanitizedLineContentTrimmed !== undefined &&
    (sanitizedLineContentTrimmed.includes(quoteTrimmed) ||
      quoteTrimmed.includes(sanitizedLineContentTrimmed));

  let quoteMatches =
    (quoteMatchesOriginal || quoteMatchesSanitized) && quoteTrimmed.length > 0;

  // Check adjacent changed lines in same diff hunk (within ±2 lines) if target line didn't directly match
  if (!quoteMatches && quoteTrimmed.length > 0) {
    const candidateLines = (
      raw.side === "RIGHT" ? ruleFile.additions : (ruleFile.deletions ?? [])
    ).filter(
      (l) =>
        l.hunkIndex === commentableLine.hunkIndex &&
        Math.abs(l.line - raw.line) <= 2,
    );
    for (const alt of candidateLines) {
      const altTrimmed = alt.content.trim();
      if (
        altTrimmed.includes(quoteTrimmed) ||
        quoteTrimmed.includes(altTrimmed)
      ) {
        quoteMatches = true;
        break;
      }
    }
  }

  if (!quoteMatches) {
    stages.push({
      stage: 5,
      stageName: "VerbatimQuoteValidation",
      passed: false,
      error: `Evidence quote "${quoteTrimmed}" does not match line content "${lineContentTrimmed}"`,
    });
    return {
      accepted: false,
      diagnostics: stages,
      rejectionReason: `Evidence quote did not match source line`,
    };
  }
  stages.push({
    stage: 5,
    stageName: "VerbatimQuoteValidation",
    passed: true,
  });

  // Stage 6: Markdown and Prose Sanitization (confidence recorded for M5 evaluation, no threshold rejection)
  // Sanitize title and message
  const sanitizedTitle = sanitizeMarkdown(
    sanitizeUnicode(sanitizeSecretOccurrencesInProse(raw.title)),
  ).trim();

  const sanitizedMessage = sanitizeMarkdown(
    sanitizeUnicode(sanitizeSecretOccurrencesInProse(raw.message)),
  ).trim();

  stages.push({
    stage: 6,
    stageName: "ConfidenceAndSanitization",
    passed: true,
  });

  // Stage 7: Provenance and Fingerprint Generation
  const lineHash = createHash("sha256")
    .update(lineEntry.content, "utf8")
    .digest("hex");

  const commitSha =
    raw.side === "RIGHT"
      ? ruleContext.pullRequest.headSha
      : ruleContext.pullRequest.baseSha;

  const candidateFinding: CandidateFinding = {
    schemaVersion: 1,
    code: `AI_${raw.category.toUpperCase()}`,
    title: sanitizedTitle,
    message: sanitizedMessage,
    severity: raw.severity,
    scope: "line",
    primaryEvidence: {
      kind: "code_line",
      path: raw.file_path,
      side: raw.side,
      line: raw.line,
      commitSha,
      lineHash,
      hunkIndex: commentableLine.hunkIndex,
    },
  };

  // Run independent evidence validation using @reviewlens/core
  const evidenceValidation = validateFindingEvidence(
    candidateFinding,
    ruleContext,
  );

  if (!evidenceValidation.valid) {
    stages.push({
      stage: 7,
      stageName: "ProvenanceAndFingerprint",
      passed: false,
      error: `Core evidence validation failed: ${evidenceValidation.code} (${evidenceValidation.reason ?? "unknown"})`,
    });
    return {
      accepted: false,
      diagnostics: stages,
      rejectionReason: `Core evidence validation failed: ${evidenceValidation.code}`,
    };
  }

  const origin: FindingOrigin = {
    kind: "ai_model",
    detectorId: AI_DETECTOR_ID,
    detectorVersion: AI_DETECTOR_VERSION,
  };

  const fingerprint = computeFindingFingerprint(
    candidateFinding,
    repoIdentifier,
    ruleContext.pullRequest.number,
    origin,
    0,
  );

  const validated: ValidatedFinding = {
    ...candidateFinding,
    origin,
    fingerprint,
    fingerprintVersion: 1,
    confidence: raw.confidence,
  };

  stages.push({
    stage: 7,
    stageName: "ProvenanceAndFingerprint",
    passed: true,
  });

  return {
    candidate: validated,
    accepted: true,
    diagnostics: stages,
  };
}
