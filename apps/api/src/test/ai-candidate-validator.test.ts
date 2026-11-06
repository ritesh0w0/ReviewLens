import { describe, it, expect } from "vitest";
import type { RuleContext } from "@reviewlens/core";
import {
  validateAIChunkFindings,
  AI_DETECTOR_ID,
  AI_DETECTOR_VERSION,
} from "../ai/validation/candidate-validator.js";
import type {
  AIChunkReviewRequest,
  AIChunkReviewResult,
  RawAICandidate,
} from "../ai/types.js";

describe("M4 7-Stage Candidate Validator", () => {
  const sampleRequest: AIChunkReviewRequest = {
    chunkIndex: 0,
    totalChunks: 1,
    modelId: "gemini-3.5-flash-lite",
    repositoryFullName: "acme/repo",
    prNumber: 42,
    headSha: "head123456789012345678901234567890123456",
    baseSha: "base123456789012345678901234567890123456",
    files: [
      {
        path: "src/auth.ts",
        patch:
          "@@ -1,1 +1,3 @@\n+const token = req.headers['auth'];\n+validate(token);",
        commentableLines: [
          { line: 1, side: "RIGHT", hunkIndex: 0 },
          { line: 2, side: "RIGHT", hunkIndex: 0 },
        ],
      },
    ],
  };

  const sampleRuleContext: RuleContext = {
    repository: { id: 1, owner: "acme", name: "repo" },
    pullRequest: {
      number: 42,
      headSha: "head123456789012345678901234567890123456",
      baseSha: "base123456789012345678901234567890123456",
    },
    metrics: {
      changedFiles: 1,
      additions: 2,
      deletions: 0,
      totalChanges: 2,
      completenessVerified: true,
    },
    files: [
      {
        path: "src/auth.ts",
        status: "modified",
        additions: [
          {
            line: 1,
            content: "const token = req.headers['auth'];",
            hunkIndex: 0,
            commitSha: "head123456789012345678901234567890123456",
          },
          {
            line: 2,
            content: "validate(token);",
            hunkIndex: 0,
            commitSha: "head123456789012345678901234567890123456",
          },
        ],
        deletions: [],
        isEligible: true,
        parseStatus: "parsed",
        metrics: { additions: 2, deletions: 0, changes: 2 },
      },
    ],
  };

  const validRawCandidate: RawAICandidate = {
    file_path: "src/auth.ts",
    line: 1,
    side: "RIGHT",
    category: "security",
    severity: "high",
    confidence: 0.95,
    title: "Unvalidated authorization header extraction",
    message: "Header extraction should be strictly validated before parsing.",
    evidence_quote: "const token = req.headers['auth'];",
  };

  it("accepts valid candidate through all 7 stages and produces ValidatedFinding", () => {
    const chunkResult: AIChunkReviewResult = {
      status: "success",
      rawFindings: [validRawCandidate],
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 120,
    };

    const outcome = validateAIChunkFindings(
      sampleRequest,
      chunkResult,
      sampleRuleContext,
    );

    expect(outcome.acceptedCandidates).toBe(1);
    expect(outcome.rejectedCandidates).toBe(0);
    expect(outcome.validatedFindings).toHaveLength(1);

    const f = outcome.validatedFindings[0]!;
    expect(f.code).toBe("AI_SECURITY");
    expect(f.severity).toBe("high");
    expect(f.origin).toEqual({
      kind: "ai_model",
      detectorId: AI_DETECTOR_ID,
      detectorVersion: AI_DETECTOR_VERSION,
    });
    expect(f.fingerprint).toHaveLength(64);
  });

  it("Stage 1: Rejects candidate when chunk status is not success", () => {
    const failedResult: AIChunkReviewResult = {
      status: "error",
      rawFindings: [validRawCandidate],
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 10,
      errorMessage: "Model timeout",
    };

    const outcome = validateAIChunkFindings(
      sampleRequest,
      failedResult,
      sampleRuleContext,
    );
    expect(outcome.acceptedCandidates).toBe(0);
    expect(outcome.validatedFindings).toHaveLength(0);
  });

  it("Stage 3: Rejects candidate when file path is not part of chunk", () => {
    const foreignCandidate: RawAICandidate = {
      ...validRawCandidate,
      file_path: "src/foreign.ts",
    };

    const outcome = validateAIChunkFindings(
      sampleRequest,
      {
        status: "success",
        rawFindings: [foreignCandidate],
        inputTokens: 50,
        outputTokens: 50,
        latencyMs: 10,
      },
      sampleRuleContext,
    );

    expect(outcome.acceptedCandidates).toBe(0);
    expect(outcome.rejectedCandidates).toBe(1);
    expect(outcome.diagnostics[0]?.rejectionReason).toContain(
      "not in chunk files",
    );
  });

  it("Stage 4: Rejects candidate when line coordinate is not commentable", () => {
    const nonCommentableCandidate: RawAICandidate = {
      ...validRawCandidate,
      line: 999, // not in diff
    };

    const outcome = validateAIChunkFindings(
      sampleRequest,
      {
        status: "success",
        rawFindings: [nonCommentableCandidate],
        inputTokens: 50,
        outputTokens: 50,
        latencyMs: 10,
      },
      sampleRuleContext,
    );

    expect(outcome.acceptedCandidates).toBe(0);
    expect(outcome.rejectedCandidates).toBe(1);
    expect(outcome.diagnostics[0]?.rejectionReason).toContain(
      "is not commentable",
    );
  });

  it("Stage 5: Rejects candidate when verbatim quote does not match code", () => {
    const hallucinatedQuote: RawAICandidate = {
      ...validRawCandidate,
      evidence_quote: "function imaginaryCodeThatDoesNotExist()",
    };

    const outcome = validateAIChunkFindings(
      sampleRequest,
      {
        status: "success",
        rawFindings: [hallucinatedQuote],
        inputTokens: 50,
        outputTokens: 50,
        latencyMs: 10,
      },
      sampleRuleContext,
    );

    expect(outcome.acceptedCandidates).toBe(0);
    expect(outcome.rejectedCandidates).toBe(1);
    expect(outcome.diagnostics[0]?.rejectionReason).toContain(
      "Evidence quote did not match",
    );
  });

  it("Stage 2 & 6: Accepts candidates with confidence 0.20, 0.65, 0.70, and 0.99 without threshold rejection", () => {
    for (const conf of [0.2, 0.65, 0.7, 0.99]) {
      const candidate: RawAICandidate = {
        ...validRawCandidate,
        confidence: conf,
      };

      const outcome = validateAIChunkFindings(
        sampleRequest,
        {
          status: "success",
          rawFindings: [candidate],
          inputTokens: 50,
          outputTokens: 50,
          latencyMs: 10,
        },
        sampleRuleContext,
      );

      expect(outcome.acceptedCandidates).toBe(1);
      expect(outcome.rejectedCandidates).toBe(0);
      expect(outcome.validatedFindings[0]?.confidence).toBe(conf);
    }
  });

  it("Stage 2: Rejects candidates with invalid confidence scores (<0, >1, or NaN)", () => {
    for (const badConf of [-0.01, 1.05, NaN]) {
      const invalidCandidate: RawAICandidate = {
        ...validRawCandidate,
        confidence: badConf,
      };

      const outcome = validateAIChunkFindings(
        sampleRequest,
        {
          status: "success",
          rawFindings: [invalidCandidate],
          inputTokens: 50,
          outputTokens: 50,
          latencyMs: 10,
        },
        sampleRuleContext,
      );

      expect(outcome.acceptedCandidates).toBe(0);
      expect(outcome.rejectedCandidates).toBe(1);
      expect(outcome.diagnostics[0]?.rejectionReason).toBe(
        "Schema validation failed",
      );
    }
  });

  it("Stage 5: Validates model-safe evidence quote against sanitized line and resolves original M2 coordinates without leaking secret", () => {
    // Diff line in rule context contains secret:
    const secretRuleContext: RuleContext = {
      ...sampleRuleContext,
      files: [
        {
          path: "src/auth.ts",
          status: "modified",
          additions: [
            {
              line: 1,
              content: 'const apiKey = "AKIAIOSFODNN7EXAMPLE";',
              hunkIndex: 0,
              commitSha: "head123456789012345678901234567890123456",
            },
          ],
          deletions: [],
          isEligible: true,
          parseStatus: "parsed",
          metrics: { additions: 1, deletions: 0, changes: 1 },
        },
      ],
    };

    // Review unit provided to model had secret redacted:
    const secretRequest: AIChunkReviewRequest = {
      ...sampleRequest,
      files: [
        {
          path: "src/auth.ts",
          patch: '@@ -1,1 +1,2 @@\n+const apiKey = "[REDACTED_SECRET]";',
          commentableLines: [{ line: 1, side: "RIGHT", hunkIndex: 0 }],
          sanitizedLines: [
            {
              line: 1,
              side: "RIGHT",
              content: 'const apiKey = "[REDACTED_SECRET]";',
            },
          ],
        },
      ],
    };

    // Model quotes the redacted snippet it saw:
    const modelCandidate: RawAICandidate = {
      file_path: "src/auth.ts",
      line: 1,
      side: "RIGHT",
      category: "security",
      severity: "critical",
      confidence: 0.98,
      title: "Hardcoded API key placeholder detected",
      message: "Do not check secrets or placeholder keys into source code.",
      evidence_quote: 'const apiKey = "[REDACTED_SECRET]";',
    };

    const outcome = validateAIChunkFindings(
      secretRequest,
      {
        status: "success",
        rawFindings: [modelCandidate],
        inputTokens: 60,
        outputTokens: 40,
        latencyMs: 50,
      },
      secretRuleContext,
    );

    expect(outcome.acceptedCandidates).toBe(1);
    const finding = outcome.validatedFindings[0]!;
    expect(finding.primaryEvidence.kind).toBe("code_line");
    if (finding.primaryEvidence.kind === "code_line") {
      // Trusted primary evidence resolves to original M2 coordinates
      expect(finding.primaryEvidence.path).toBe("src/auth.ts");
      expect(finding.primaryEvidence.line).toBe(1);
      expect(finding.primaryEvidence.side).toBe("RIGHT");
      expect(finding.primaryEvidence.commitSha).toBe(
        "head123456789012345678901234567890123456",
      );
      // lineHash matches original unredacted line hash
      expect(finding.primaryEvidence.lineHash).toBeDefined();
    }
    // Raw secret is not leaked in finding title or message
    expect(finding.title).not.toContain("AKIA");
    expect(finding.message).not.toContain("AKIA");
  });

  it("Stage 6: Sanitizes raw secrets and markdown @mentions in accepted candidate message", () => {
    const leakingCandidate: RawAICandidate = {
      ...validRawCandidate,
      message:
        "Notify @alice: detected token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890 in header.",
    };

    const outcome = validateAIChunkFindings(
      sampleRequest,
      {
        status: "success",
        rawFindings: [leakingCandidate],
        inputTokens: 50,
        outputTokens: 50,
        latencyMs: 10,
      },
      sampleRuleContext,
    );

    expect(outcome.acceptedCandidates).toBe(1);
    const f = outcome.validatedFindings[0]!;
    expect(f.message).not.toContain("ghp_");
    expect(f.message).toContain("[REDACTED_SECRET]");
    // @alice has zero-width space after @
    expect(f.message).toContain("@\u200Balice");
  });
});
