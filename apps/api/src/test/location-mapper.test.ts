import { describe, expect, it } from "vitest";
import { buildFileLocationIndex } from "../pipeline/commentable-line-mapper.js";
import { parseUnifiedPatch } from "../pipeline/unified-diff-parser.js";
import type { ParsedFileDiff } from "../pipeline/types.js";

describe("Commentable-Line Mapping (Step 3)", () => {
  const headSha = "abcdef1234567890abcdef1234567890abcdef12";

  it("maps additions to RIGHT / newLine with isChanged: true", () => {
    const patch = "@@ -0,0 +1,2 @@\n+line1\n+line2";
    const diff = parseUnifiedPatch(patch, {
      path: "src/new.ts",
      additions: 2,
      deletions: 0,
    });

    const { locations, error } = buildFileLocationIndex(diff, headSha);
    expect(error).toBeUndefined();
    expect(locations).toBeDefined();

    const loc1 = locations!.find("src/new.ts", "RIGHT", 1);
    expect(loc1).toBeDefined();
    expect(loc1).toEqual({
      path: "src/new.ts",
      side: "RIGHT",
      line: 1,
      kind: "addition",
      isChanged: true,
      content: "line1",
      hunkIndex: 0,
      commitSha: headSha,
    });

    const loc2 = locations!.find("src/new.ts", "RIGHT", 2);
    expect(loc2).toBeDefined();
    expect(loc2!.kind).toBe("addition");
    expect(loc2!.isChanged).toBe(true);
  });

  it("maps deletions to LEFT / oldLine with isChanged: true", () => {
    const patch = "@@ -20,2 +19,0 @@\n-deletedOne\n-deletedTwo";
    const diff = parseUnifiedPatch(patch, {
      path: "src/del.ts",
      additions: 0,
      deletions: 2,
    });

    const { locations, error } = buildFileLocationIndex(diff, headSha);
    expect(error).toBeUndefined();
    expect(locations).toBeDefined();

    const loc1 = locations!.find("src/del.ts", "LEFT", 20);
    expect(loc1).toBeDefined();
    expect(loc1).toEqual({
      path: "src/del.ts",
      side: "LEFT",
      line: 20,
      kind: "deletion",
      isChanged: true,
      content: "deletedOne",
      hunkIndex: 0,
      commitSha: headSha,
    });

    const loc2 = locations!.find("src/del.ts", "LEFT", 21);
    expect(loc2).toBeDefined();
    expect(loc2!.line).toBe(21);
    expect(loc2!.side).toBe("LEFT");
  });

  it("maps context lines to RIGHT / newLine with isChanged: false and correct shifted coordinate", () => {
    const patch = [
      "@@ -10,4 +10,3 @@",
      " context1",
      "-deleted",
      "-deleted2",
      "+added",
      " context2",
    ].join("\n");

    const diff = parseUnifiedPatch(patch, {
      path: "src/shift.ts",
      additions: 1,
      deletions: 2,
    });

    const { locations, error } = buildFileLocationIndex(diff, headSha);
    expect(error).toBeUndefined();
    expect(locations).toBeDefined();

    // Context 1: old 10, new 10
    const ctx1 = locations!.find("src/shift.ts", "RIGHT", 10);
    expect(ctx1).toBeDefined();
    expect(ctx1!.isChanged).toBe(false);
    expect(ctx1!.kind).toBe("context");

    // Deletion: old 11
    const del1 = locations!.find("src/shift.ts", "LEFT", 11);
    expect(del1).toBeDefined();
    expect(del1!.kind).toBe("deletion");

    // Addition: new 11
    const add1 = locations!.find("src/shift.ts", "RIGHT", 11);
    expect(add1).toBeDefined();
    expect(add1!.kind).toBe("addition");

    // Context 2: old 13, new 12
    const ctx2 = locations!.find("src/shift.ts", "RIGHT", 12);
    expect(ctx2).toBeDefined();
    expect(ctx2!.content).toBe("context2");
    expect(ctx2!.isChanged).toBe(false);
  });

  it("distinguishes same numeric line on LEFT and RIGHT without merging", () => {
    const patch = "@@ -5,1 +5,1 @@\n-oldContent\n+newContent";
    const diff = parseUnifiedPatch(patch, {
      path: "src/same.ts",
      additions: 1,
      deletions: 1,
    });

    const { locations } = buildFileLocationIndex(diff, headSha);
    expect(locations).toBeDefined();

    const left = locations!.find("src/same.ts", "LEFT", 5);
    const right = locations!.find("src/same.ts", "RIGHT", 5);

    expect(left).toBeDefined();
    expect(right).toBeDefined();
    expect(left!.side).toBe("LEFT");
    expect(left!.content).toBe("oldContent");
    expect(right!.side).toBe("RIGHT");
    expect(right!.content).toBe("newContent");
    expect(locations!.size).toBe(2);
  });

  it("preserves hunkIndex and commitSha across multiple hunks", () => {
    const patch = [
      "@@ -1,1 +1,2 @@",
      " h1ctx",
      "+h1add",
      "@@ -20,1 +20,2 @@",
      " h2ctx",
      "+h2add",
    ].join("\n");

    const diff = parseUnifiedPatch(patch, {
      path: "src/hunks.ts",
      additions: 2,
      deletions: 0,
    });

    const { locations, error } = buildFileLocationIndex(diff, headSha);
    expect(error).toBeUndefined();
    expect(locations).toBeDefined();

    const locHunk0 = locations!.find("src/hunks.ts", "RIGHT", 2);
    expect(locHunk0?.hunkIndex).toBe(0);
    expect(locHunk0?.commitSha).toBe(headSha);

    const locHunk1 = locations!.find("src/hunks.ts", "RIGHT", 21);
    expect(locHunk1?.hunkIndex).toBe(1);
    expect(locHunk1?.commitSha).toBe(headSha);
  });

  it("returns undefined for unknown path, side, or line numbers", () => {
    const patch = "@@ -0,0 +1,1 @@\n+line";
    const diff = parseUnifiedPatch(patch, {
      path: "src/lookup.ts",
      additions: 1,
      deletions: 0,
    });

    const { locations, error } = buildFileLocationIndex(diff, headSha);
    expect(error).toBeUndefined();
    expect(locations).toBeDefined();

    expect(locations!.find("src/other.ts", "RIGHT", 1)).toBeUndefined();
    expect(locations!.find("src/lookup.ts", "LEFT", 1)).toBeUndefined();
    expect(locations!.find("src/lookup.ts", "RIGHT", 999)).toBeUndefined();
  });

  it("rejects mapping for files that are not parseStatus 'parsed'", () => {
    const unavailDiff: ParsedFileDiff = {
      path: "bin.dat",
      parseStatus: "patch_unavailable",
      hunks: [],
      additions: 0,
      deletions: 0,
    };
    const res1 = buildFileLocationIndex(unavailDiff, headSha);
    expect(res1.error).toContain("patch_unavailable");
    expect(res1.locations).toBeUndefined();

    const malformedDiff: ParsedFileDiff = {
      path: "bad.ts",
      parseStatus: "malformed",
      hunks: [],
      additions: 0,
      deletions: 0,
    };
    const res2 = buildFileLocationIndex(malformedDiff, headSha);
    expect(res2.error).toContain("malformed");
    expect(res2.locations).toBeUndefined();
  });

  it("rejects conflicting duplicate coordinate mappings", () => {
    // Artificial diff with conflicting line content for same coordinate
    const conflictingDiff: ParsedFileDiff = {
      path: "conflict.ts",
      parseStatus: "parsed",
      additions: 2,
      deletions: 0,
      hunks: [
        {
          oldStart: 1,
          oldCount: 0,
          newStart: 10,
          newCount: 2,
          header: "@@ -1,0 +10,2 @@",
          lines: [
            { kind: "addition", content: "version A", newLine: 10 },
            { kind: "addition", content: "version B", newLine: 10 }, // conflict on same line
          ],
        },
      ],
    };

    const res = buildFileLocationIndex(conflictingDiff, headSha);
    expect(res.error).toContain("Conflicting coordinate entry");
    expect(res.locations).toBeUndefined();
  });

  it("supports getAllForPath and getAll on location index", () => {
    const patch = "@@ -1,1 +1,2 @@\n context\n+new";
    const diff = parseUnifiedPatch(patch, {
      path: "src/list.ts",
      additions: 1,
      deletions: 0,
    });

    const { locations, error } = buildFileLocationIndex(diff, headSha);
    expect(error).toBeUndefined();
    expect(locations).toBeDefined();

    const forPath = locations!.getAllForPath("src/list.ts");
    expect(forPath).toHaveLength(2);

    const all = locations!.getAll();
    expect(all).toHaveLength(2);
  });
});
