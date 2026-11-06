import type {
  PreparedFile,
  PreparedReviewInput,
} from "../../pipeline/types.js";
import { CONTEXT_LIMITS } from "../config.js";
import { isSensitivePath } from "../security/sensitive-path-filter.js";
import { scanAndSanitizeContent } from "../security/secret-scanner.js";
import { sanitizeUnicode } from "../security/unicode-sanitizer.js";
import type { AIReviewUnit, ReviewUnitFile } from "../types.js";
import {
  extractLineWindow,
  type BoundedFileContent,
} from "./source-fetcher.js";

function resolvePatch(prepFile: PreparedFile): string | undefined {
  if (prepFile.metadata.patch) return prepFile.metadata.patch;
  if (!prepFile.diff?.hunks?.length) return undefined;
  return prepFile.diff.hunks
    .map((hunk) => {
      const body = hunk.lines
        .map((l) => {
          if (l.kind === "addition") return `+${l.content}`;
          if (l.kind === "deletion") return `-${l.content}`;
          return ` ${l.content}`;
        })
        .join("\n");
      return `${hunk.header}\n${body}`;
    })
    .join("\n");
}

export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  // Conservative code token estimation: ~3.8 chars per token
  return Math.ceil(text.length / 3.8);
}

export function buildReviewUnits(
  prepared: PreparedReviewInput,
  sourceFiles?: ReadonlyMap<string, BoundedFileContent>,
): AIReviewUnit[] {
  const units: AIReviewUnit[] = [];

  for (const prepFile of prepared.files) {
    if (
      prepFile.parseStatus !== "parsed" ||
      !prepFile.filterDecision.included
    ) {
      continue;
    }

    const { path, previousPath } = prepFile.metadata;
    const patch = resolvePatch(prepFile);

    // Filter out sensitive paths
    if (
      isSensitivePath(path) ||
      (previousPath && isSensitivePath(previousPath))
    ) {
      continue;
    }

    if (!patch) {
      continue;
    }

    // Secret scan the patch
    const patchScan = scanAndSanitizeContent(patch);
    if (patchScan.action === "exclude_file") {
      continue;
    }

    const sanitizedPatch = sanitizeUnicode(patchScan.content);

    // Extract commentable lines from location index (only changed lines can be commented on)
    const commentableLocations = prepFile.locations
      ? prepFile.locations.getAllForPath(path).filter((loc) => loc.isChanged)
      : [];

    const commentableLines = commentableLocations.map((loc) => ({
      line: loc.line,
      side: loc.side,
      hunkIndex: loc.hunkIndex,
    }));

    const sanitizedLines = commentableLocations.map((loc) => {
      const lineScan = scanAndSanitizeContent(loc.content);
      const sanitizedContent = sanitizeUnicode(lineScan.content);
      return {
        line: loc.line,
        side: loc.side,
        content: sanitizedContent,
      };
    });

    // Bounded source context around changed lines
    let boundedContent: string | undefined;
    if (sourceFiles && sourceFiles.has(path)) {
      const source = sourceFiles.get(path);
      if (source?.content) {
        const changedRightLines = commentableLines
          .filter((cl) => cl.side === "RIGHT")
          .map((cl) => cl.line);
        boundedContent = extractLineWindow(
          source.content,
          changedRightLines,
          CONTEXT_LIMITS.CONTEXT_WINDOW_LINES,
        );
      }
    }

    const fileUnit: ReviewUnitFile = {
      path,
      oldPath: previousPath,
      patch: sanitizedPatch,
      boundedContent,
      commentableLines,
      sanitizedLines,
    };

    const estimatedTokens =
      estimateTokenCount(sanitizedPatch) +
      estimateTokenCount(boundedContent ?? "") +
      100; // prompt overhead

    units.push({
      id: `unit_${path}`,
      files: [fileUnit],
      estimatedTokens,
    });
  }

  return units;
}

export interface PackedChunk {
  readonly chunkIndex: number;
  readonly units: readonly AIReviewUnit[];
  readonly files: readonly ReviewUnitFile[];
  readonly estimatedTokens: number;
}

export function packUnitsIntoChunks(
  units: readonly AIReviewUnit[],
  maxTokensPerChunk: number,
  maxChunks: number = CONTEXT_LIMITS.MAX_REQUEST_CHUNKS_PER_RUN,
): PackedChunk[] {
  const chunks: PackedChunk[] = [];
  let currentUnits: AIReviewUnit[] = [];
  let currentFiles: ReviewUnitFile[] = [];
  let currentTokens = 0;

  for (const unit of units) {
    if (chunks.length >= maxChunks) {
      break;
    }

    // If unit fits in current chunk
    if (
      currentUnits.length > 0 &&
      currentTokens + unit.estimatedTokens > maxTokensPerChunk
    ) {
      // Finalize current chunk
      chunks.push({
        chunkIndex: chunks.length,
        units: currentUnits,
        files: currentFiles,
        estimatedTokens: currentTokens,
      });

      currentUnits = [];
      currentFiles = [];
      currentTokens = 0;

      if (chunks.length >= maxChunks) {
        break;
      }
    }

    currentUnits.push(unit);
    currentFiles.push(...unit.files);
    currentTokens += unit.estimatedTokens;
  }

  if (currentUnits.length > 0 && chunks.length < maxChunks) {
    chunks.push({
      chunkIndex: chunks.length,
      units: currentUnits,
      files: currentFiles,
      estimatedTokens: currentTokens,
    });
  }

  return chunks;
}
