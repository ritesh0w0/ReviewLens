import type {
  ParsedFileDiff,
  ReviewLocation,
  ReviewLocationIndex,
  ReviewSide,
} from "./types.js";

export class InMemoryReviewLocationIndex implements ReviewLocationIndex {
  private readonly map = new Map<string, ReviewLocation>();
  private readonly byPath = new Map<string, ReviewLocation[]>();

  constructor(locations: ReviewLocation[]) {
    for (const loc of locations) {
      const key = InMemoryReviewLocationIndex.formatKey(
        loc.path,
        loc.side,
        loc.line,
      );
      this.map.set(key, loc);

      const pathList = this.byPath.get(loc.path) ?? [];
      pathList.push(loc);
      this.byPath.set(loc.path, pathList);
    }
  }

  static formatKey(path: string, side: ReviewSide, line: number): string {
    return `${path}:${side}:${line}`;
  }

  find(
    path: string,
    side: ReviewSide,
    line: number,
  ): ReviewLocation | undefined {
    return this.map.get(
      InMemoryReviewLocationIndex.formatKey(path, side, line),
    );
  }

  getAllForPath(path: string): ReviewLocation[] {
    return this.byPath.get(path) ?? [];
  }

  getAll(): ReviewLocation[] {
    return Array.from(this.map.values());
  }

  get size(): number {
    return this.map.size;
  }
}

export interface MapFileLocationsResult {
  locations?: ReviewLocationIndex;
  error?: string;
}

export function buildFileLocationIndex(
  diff: ParsedFileDiff,
  commitSha: string,
): MapFileLocationsResult {
  if (diff.parseStatus !== "parsed") {
    return {
      error: `Cannot map locations for file with parseStatus '${diff.parseStatus}'`,
    };
  }

  const locations: ReviewLocation[] = [];
  const seenCoordinates = new Map<
    string,
    { content: string; hunkIndex: number }
  >();

  for (let hunkIndex = 0; hunkIndex < diff.hunks.length; hunkIndex++) {
    const hunk = diff.hunks[hunkIndex]!;

    for (const line of hunk.lines) {
      let side: ReviewSide;
      let lineNumber: number;
      let isChanged: boolean;

      if (line.kind === "context") {
        side = "RIGHT";
        lineNumber = line.newLine;
        isChanged = false;
      } else if (line.kind === "addition") {
        side = "RIGHT";
        lineNumber = line.newLine;
        isChanged = true;
      } else if (line.kind === "deletion") {
        side = "LEFT";
        lineNumber = line.oldLine;
        isChanged = true;
      } else {
        continue;
      }

      if (!Number.isSafeInteger(lineNumber) || lineNumber <= 0) {
        return {
          error: `Invalid line coordinate ${lineNumber} on ${side} for ${diff.path}`,
        };
      }

      const key = InMemoryReviewLocationIndex.formatKey(
        diff.path,
        side,
        lineNumber,
      );
      const existing = seenCoordinates.get(key);

      if (existing) {
        // Conflicting coordinate check: if content or hunk differs, reject
        if (
          existing.content !== line.content ||
          existing.hunkIndex !== hunkIndex
        ) {
          return {
            error: `Conflicting coordinate entry for ${key}: content mismatch`,
          };
        }
        // Identical duplicate line: skip duplicate entry
        continue;
      }

      seenCoordinates.set(key, { content: line.content, hunkIndex });

      locations.push({
        path: diff.path,
        side,
        line: lineNumber,
        kind: line.kind,
        isChanged,
        content: line.content,
        hunkIndex,
        commitSha,
      });
    }
  }

  return {
    locations: new InMemoryReviewLocationIndex(locations),
  };
}
