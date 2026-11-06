import type { DiffHunk, ParsedFileDiff, ParseStatus } from "./types.js";

export const MAX_FILE_PATCH_BYTES = 1024 * 1024; // 1 MiB per file patch

const HUNK_HEADER_REGEX =
  /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(?:[\s\t]+(.*))?$/;

export interface FileDiffInputMetadata {
  path: string;
  previousPath?: string;
  additions: number;
  deletions: number;
}

export function parseUnifiedPatch(
  patch: string | undefined | null,
  metadata: FileDiffInputMetadata,
): ParsedFileDiff {
  const { path, previousPath, additions, deletions } = metadata;

  // 1. Missing patch
  if (patch === undefined || patch === null) {
    return {
      path,
      previousPath,
      parseStatus: "patch_unavailable",
      hunks: [],
      additions: 0,
      deletions: 0,
      diagnosticCode: "PATCH_UNAVAILABLE",
    };
  }

  // 2. Per-file patch size limit
  const byteLength = Buffer.byteLength(patch, "utf8");
  if (byteLength > MAX_FILE_PATCH_BYTES) {
    return {
      path,
      previousPath,
      parseStatus: "unsupported",
      hunks: [],
      additions: 0,
      deletions: 0,
      diagnosticCode: "PATCH_TOO_LARGE",
    };
  }

  // 3. Combined diff check (e.g. merge diff syntax `@@@`)
  if (patch.includes("@@@")) {
    return {
      path,
      previousPath,
      parseStatus: "unsupported",
      hunks: [],
      additions: 0,
      deletions: 0,
      diagnosticCode: "COMBINED_DIFF_UNSUPPORTED",
    };
  }

  // 4. Empty patch string
  if (patch.trim() === "") {
    if (additions === 0 && deletions === 0) {
      return {
        path,
        previousPath,
        parseStatus: "parsed",
        hunks: [],
        additions: 0,
        deletions: 0,
      };
    } else {
      return {
        path,
        previousPath,
        parseStatus: "malformed",
        hunks: [],
        additions: 0,
        deletions: 0,
        diagnosticCode: "EMPTY_PATCH_NONZERO_COUNTS",
      };
    }
  }

  // Normalize line endings
  const rawLines = patch.replace(/\r\n/g, "\n").split("\n");

  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let oldCursor = 0;
  let newCursor = 0;
  let oldConsumed = 0;
  let newConsumed = 0;
  let hunkHeader = "";

  function finalizeCurrentHunk(): { valid: boolean; code?: string } {
    if (!currentHunk) return { valid: true };

    if (
      oldConsumed !== currentHunk.oldCount ||
      newConsumed !== currentHunk.newCount
    ) {
      return {
        valid: false,
        code: `HUNK_COUNT_MISMATCH: expected -${currentHunk.oldCount},+${currentHunk.newCount} but consumed -${oldConsumed},+${newConsumed}`,
      };
    }

    hunks.push(currentHunk);
    currentHunk = null;
    return { valid: true };
  }

  for (let lineIndex = 0; lineIndex < rawLines.length; lineIndex++) {
    const line = rawLines[lineIndex]!;

    // Ignore trailing empty line resulting from final newline split
    if (lineIndex === rawLines.length - 1 && line === "" && currentHunk) {
      break;
    }

    if (line.startsWith("@@")) {
      // Finalize previous hunk if any
      const finalized = finalizeCurrentHunk();
      if (!finalized.valid) {
        return createFailure(
          path,
          previousPath,
          "malformed",
          finalized.code ?? "HUNK_COUNT_MISMATCH",
        );
      }

      const match = HUNK_HEADER_REGEX.exec(line);
      if (!match) {
        return createFailure(
          path,
          previousPath,
          "malformed",
          "MALFORMED_HUNK_HEADER",
        );
      }

      const oldStart = parseInt(match[1]!, 10);
      const oldCount = match[2] !== undefined ? parseInt(match[2], 10) : 1;
      const newStart = parseInt(match[3]!, 10);
      const newCount = match[4] !== undefined ? parseInt(match[4], 10) : 1;

      if (
        !Number.isSafeInteger(oldStart) ||
        !Number.isSafeInteger(newStart) ||
        !Number.isSafeInteger(oldCount) ||
        !Number.isSafeInteger(newCount) ||
        oldStart < 0 ||
        newStart < 0 ||
        oldCount < 0 ||
        newCount < 0
      ) {
        return createFailure(
          path,
          previousPath,
          "malformed",
          "INVALID_HUNK_NUMBERS",
        );
      }

      oldCursor = oldStart;
      newCursor = newStart;
      oldConsumed = 0;
      newConsumed = 0;
      hunkHeader = line;

      currentHunk = {
        oldStart,
        oldCount,
        newStart,
        newCount,
        header: hunkHeader,
        lines: [],
      };
      continue;
    }

    if (!currentHunk) {
      // Line encountered before any hunk header
      return createFailure(
        path,
        previousPath,
        "malformed",
        "LINE_BEFORE_HUNK_HEADER",
      );
    }

    const prefix = line.length > 0 ? line[0] : " ";
    const content = line.length > 0 ? line.slice(1) : "";

    if (prefix === " ") {
      // Context line
      currentHunk.lines.push({
        kind: "context",
        content,
        oldLine: oldCursor,
        newLine: newCursor,
      });
      oldCursor++;
      newCursor++;
      oldConsumed++;
      newConsumed++;
    } else if (prefix === "+") {
      // Addition
      currentHunk.lines.push({
        kind: "addition",
        content,
        newLine: newCursor,
      });
      newCursor++;
      newConsumed++;
    } else if (prefix === "-") {
      // Deletion
      currentHunk.lines.push({
        kind: "deletion",
        content,
        oldLine: oldCursor,
      });
      oldCursor++;
      oldConsumed++;
    } else if (prefix === "\\") {
      // No newline marker: e.g. "\ No newline at end of file"
      // Metadata line: does not increment line counters or consumed count
      continue;
    } else {
      // Unexpected diff prefix: fail closed
      return createFailure(
        path,
        previousPath,
        "malformed",
        `UNEXPECTED_DIFF_SYNTAX: line does not start with space, +, -, or \\`,
      );
    }
  }

  // Finalize the last hunk
  const finalized = finalizeCurrentHunk();
  if (!finalized.valid) {
    return createFailure(
      path,
      previousPath,
      "malformed",
      finalized.code ?? "HUNK_COUNT_MISMATCH",
    );
  }

  if (hunks.length === 0) {
    return createFailure(path, previousPath, "malformed", "NO_HUNKS_FOUND");
  }

  // Count parsed additions and deletions
  let parsedAdditions = 0;
  let parsedDeletions = 0;

  for (const hunk of hunks) {
    for (const dl of hunk.lines) {
      if (dl.kind === "addition") parsedAdditions++;
      if (dl.kind === "deletion") parsedDeletions++;
    }
  }

  // Cross-check with GitHub metadata
  if (parsedAdditions !== additions || parsedDeletions !== deletions) {
    return createFailure(
      path,
      previousPath,
      "malformed",
      `METADATA_COUNT_MISMATCH: parsed (+${parsedAdditions}, -${parsedDeletions}) vs github (+${additions}, -${deletions})`,
    );
  }

  return {
    path,
    previousPath,
    parseStatus: "parsed",
    hunks,
    additions: parsedAdditions,
    deletions: parsedDeletions,
  };
}

function createFailure(
  path: string,
  previousPath: string | undefined,
  parseStatus: ParseStatus,
  diagnosticCode: string,
): ParsedFileDiff {
  return {
    path,
    previousPath,
    parseStatus,
    hunks: [],
    additions: 0,
    deletions: 0,
    diagnosticCode,
  };
}
