import { describe, expect, it } from "vitest";
import {
  parseUnifiedPatch,
  MAX_FILE_PATCH_BYTES,
} from "../pipeline/unified-diff-parser.js";

describe("Strict Unified Diff Parser (Step 2)", () => {
  it("parses an addition-only patch correctly", () => {
    const patch = `@@ -0,0 +1,3 @@\n+const a = 1;\n+const b = 2;\n+const c = 3;`;
    const res = parseUnifiedPatch(patch, {
      path: "src/new-file.ts",
      additions: 3,
      deletions: 0,
    });

    expect(res.parseStatus).toBe("parsed");
    expect(res.hunks.length).toBe(1);
    expect(res.hunks[0]!.lines).toHaveLength(3);
    expect(res.hunks[0]!.lines[0]).toEqual({
      kind: "addition",
      content: "const a = 1;",
      newLine: 1,
    });
    expect(res.hunks[0]!.lines[1]).toEqual({
      kind: "addition",
      content: "const b = 2;",
      newLine: 2,
    });
    expect(res.hunks[0]!.lines[2]).toEqual({
      kind: "addition",
      content: "const c = 3;",
      newLine: 3,
    });
    expect(res.additions).toBe(3);
    expect(res.deletions).toBe(0);
  });

  it("parses a deletion-only patch correctly", () => {
    const patch = `@@ -10,2 +9,0 @@\n-const oldOne = 1;\n-const oldTwo = 2;`;
    const res = parseUnifiedPatch(patch, {
      path: "src/cleanup.ts",
      additions: 0,
      deletions: 2,
    });

    expect(res.parseStatus).toBe("parsed");
    expect(res.hunks.length).toBe(1);
    expect(res.hunks[0]!.lines).toHaveLength(2);
    expect(res.hunks[0]!.lines[0]).toEqual({
      kind: "deletion",
      content: "const oldOne = 1;",
      oldLine: 10,
    });
    expect(res.hunks[0]!.lines[1]).toEqual({
      kind: "deletion",
      content: "const oldTwo = 2;",
      oldLine: 11,
    });
    expect(res.additions).toBe(0);
    expect(res.deletions).toBe(2);
  });

  it("parses a replacement patch with exact line coordinates for every line", () => {
    const patch = [
      "@@ -10,4 +10,5 @@",
      " function calculate(items) {",
      "-  return items.length;",
      "+  const total = items.reduce((s, i) => s + i.price, 0);",
      "+  return total;",
      " }",
      " export default calculate;",
    ].join("\n");

    const res = parseUnifiedPatch(patch, {
      path: "src/calc.ts",
      additions: 2,
      deletions: 1,
    });

    expect(res.parseStatus).toBe("parsed");
    expect(res.hunks).toHaveLength(1);

    const lines = res.hunks[0]!.lines;
    expect(lines).toHaveLength(6);

    // Context line 1
    expect(lines[0]).toEqual({
      kind: "context",
      content: "function calculate(items) {",
      oldLine: 10,
      newLine: 10,
    });

    // Deletion
    expect(lines[1]).toEqual({
      kind: "deletion",
      content: "  return items.length;",
      oldLine: 11,
    });

    // Addition 1
    expect(lines[2]).toEqual({
      kind: "addition",
      content: "  const total = items.reduce((s, i) => s + i.price, 0);",
      newLine: 11,
    });

    // Addition 2
    expect(lines[3]).toEqual({
      kind: "addition",
      content: "  return total;",
      newLine: 12,
    });

    // Context line 2
    expect(lines[4]).toEqual({
      kind: "context",
      content: "}",
      oldLine: 12,
      newLine: 13,
    });

    // Context line 3
    expect(lines[5]).toEqual({
      kind: "context",
      content: "export default calculate;",
      oldLine: 13,
      newLine: 14,
    });

    expect(res.additions).toBe(2);
    expect(res.deletions).toBe(1);
  });

  it("parses multiple hunks with distinct starting coordinates without counter carryover", () => {
    const patch = [
      "@@ -5,3 +5,4 @@",
      " const first = 1;",
      "+const addedOne = 1.5;",
      " const second = 2;",
      " const third = 3;",
      "@@ -50,3 +51,3 @@",
      " const fifty = 50;",
      "-const fiftyOne = 51;",
      "+const fiftyOneNew = 51.1;",
      " const fiftyTwo = 52;",
    ].join("\n");

    const res = parseUnifiedPatch(patch, {
      path: "src/multi.ts",
      additions: 2,
      deletions: 1,
    });

    expect(res.parseStatus).toBe("parsed");
    expect(res.hunks).toHaveLength(2);

    // Hunk 1 assertions
    expect(res.hunks[0]!.oldStart).toBe(5);
    expect(res.hunks[0]!.newStart).toBe(5);
    expect(res.hunks[0]!.lines[1]).toEqual({
      kind: "addition",
      content: "const addedOne = 1.5;",
      newLine: 6,
    });

    // Hunk 2 assertions (reset to 50 / 51, never continuing from previous hunk)
    expect(res.hunks[1]!.oldStart).toBe(50);
    expect(res.hunks[1]!.newStart).toBe(51);
    expect(res.hunks[1]!.lines[0]).toEqual({
      kind: "context",
      content: "const fifty = 50;",
      oldLine: 50,
      newLine: 51,
    });
    expect(res.hunks[1]!.lines[1]).toEqual({
      kind: "deletion",
      content: "const fiftyOne = 51;",
      oldLine: 51,
    });
    expect(res.hunks[1]!.lines[2]).toEqual({
      kind: "addition",
      content: "const fiftyOneNew = 51.1;",
      newLine: 52,
    });
  });

  it("handles zero-length old and new ranges", () => {
    // New file: zero-length old range
    const newFilePatch = "@@ -0,0 +1,2 @@\n+line1\n+line2";
    const resNew = parseUnifiedPatch(newFilePatch, {
      path: "new.ts",
      additions: 2,
      deletions: 0,
    });
    expect(resNew.parseStatus).toBe("parsed");
    expect(resNew.hunks[0]!.oldCount).toBe(0);
    expect(resNew.hunks[0]!.newCount).toBe(2);

    // Deleted file: zero-length new range
    const delFilePatch = "@@ -1,2 +0,0 @@\n-line1\n-line2";
    const resDel = parseUnifiedPatch(delFilePatch, {
      path: "deleted.ts",
      additions: 0,
      deletions: 2,
    });
    expect(resDel.parseStatus).toBe("parsed");
    expect(resDel.hunks[0]!.oldCount).toBe(2);
    expect(resDel.hunks[0]!.newCount).toBe(0);
  });

  it("defaults omitted hunk counts to 1", () => {
    const patch = "@@ -5 +5 @@\n-old\n+new";
    const res = parseUnifiedPatch(patch, {
      path: "single.ts",
      additions: 1,
      deletions: 1,
    });

    expect(res.parseStatus).toBe("parsed");
    expect(res.hunks[0]!.oldCount).toBe(1);
    expect(res.hunks[0]!.newCount).toBe(1);
    expect(res.hunks[0]!.lines[0]).toEqual({
      kind: "deletion",
      content: "old",
      oldLine: 5,
    });
    expect(res.hunks[0]!.lines[1]).toEqual({
      kind: "addition",
      content: "new",
      newLine: 5,
    });
  });

  it("ignores \\ No newline at end of file marker without incrementing counters", () => {
    const patch = [
      "@@ -1,2 +1,2 @@",
      " line1",
      "-oldEnd",
      "\\ No newline at end of file",
      "+newEnd",
      "\\ No newline at end of file",
    ].join("\n");

    const res = parseUnifiedPatch(patch, {
      path: "file.txt",
      additions: 1,
      deletions: 1,
    });

    expect(res.parseStatus).toBe("parsed");
    expect(res.hunks[0]!.lines).toHaveLength(3); // 1 context, 1 deletion, 1 addition
    expect(res.additions).toBe(1);
    expect(res.deletions).toBe(1);
  });

  it("handles CRLF line endings cleanly", () => {
    const patch = "@@ -1,2 +1,2 @@\r\n context\r\n-old\r\n+new";
    const res = parseUnifiedPatch(patch, {
      path: "crlf.ts",
      additions: 1,
      deletions: 1,
    });

    expect(res.parseStatus).toBe("parsed");
    expect(res.hunks[0]!.lines[1]!.content).toBe("old");
    expect(res.hunks[0]!.lines[2]!.content).toBe("new");
  });

  it("handles optional hunk section heading after @@", () => {
    const patch =
      "@@ -10,2 +10,2 @@ function myFunc(a, b) {\n context\n-old\n+new";
    const res = parseUnifiedPatch(patch, {
      path: "heading.ts",
      additions: 1,
      deletions: 1,
    });

    expect(res.parseStatus).toBe("parsed");
    expect(res.hunks[0]!.lines[0]!.content).toBe("context");
  });

  it("handles empty source line in diff", () => {
    const patch = "@@ -1,3 +1,3 @@\n top\n \n bottom";
    const res = parseUnifiedPatch(patch, {
      path: "empty-line.ts",
      additions: 0,
      deletions: 0,
    });

    expect(res.parseStatus).toBe("parsed");
    expect(res.hunks[0]!.lines[1]!.content).toBe("");
  });

  it("rejects malformed hunk header", () => {
    const patch = "@@ not-a-valid-header @@\n+line";
    const res = parseUnifiedPatch(patch, {
      path: "bad.ts",
      additions: 1,
      deletions: 0,
    });

    expect(res.parseStatus).toBe("malformed");
    expect(res.diagnosticCode).toBe("MALFORMED_HUNK_HEADER");
  });

  it("rejects hunk when consumed lines do not match declared counts (old count mismatch)", () => {
    // Declares 3 old lines, but patch only has 2
    const patch = "@@ -1,3 +1,2 @@\n context\n-del";
    const res = parseUnifiedPatch(patch, {
      path: "mismatch.ts",
      additions: 0,
      deletions: 1,
    });

    expect(res.parseStatus).toBe("malformed");
    expect(res.diagnosticCode).toContain("HUNK_COUNT_MISMATCH");
  });

  it("rejects hunk when consumed lines do not match declared counts (new count mismatch)", () => {
    // Declares 3 new lines, but patch only has 2
    const patch = "@@ -1,2 +1,3 @@\n context\n+add";
    const res = parseUnifiedPatch(patch, {
      path: "mismatch.ts",
      additions: 1,
      deletions: 0,
    });

    expect(res.parseStatus).toBe("malformed");
    expect(res.diagnosticCode).toContain("HUNK_COUNT_MISMATCH");
  });

  it("rejects unexpected lines that do not start with valid diff prefix", () => {
    const patch = "@@ -1,2 +1,2 @@\n context\n?invalidPrefix\n";
    const res = parseUnifiedPatch(patch, {
      path: "invalid.ts",
      additions: 0,
      deletions: 0,
    });

    expect(res.parseStatus).toBe("malformed");
    expect(res.diagnosticCode).toContain("UNEXPECTED_DIFF_SYNTAX");
  });

  it("detects combined diff syntax (@@@) and marks it unsupported", () => {
    const patch = "@@@ -1,5 -1,5 +1,5 @@@\n-old\n+new";
    const res = parseUnifiedPatch(patch, {
      path: "merge.ts",
      additions: 1,
      deletions: 1,
    });

    expect(res.parseStatus).toBe("unsupported");
    expect(res.diagnosticCode).toBe("COMBINED_DIFF_UNSUPPORTED");
  });

  it("returns patch_unavailable when patch is null or undefined", () => {
    const resNull = parseUnifiedPatch(null, {
      path: "binary.png",
      additions: 0,
      deletions: 0,
    });
    expect(resNull.parseStatus).toBe("patch_unavailable");

    const resUndef = parseUnifiedPatch(undefined, {
      path: "binary.png",
      additions: 0,
      deletions: 0,
    });
    expect(resUndef.parseStatus).toBe("patch_unavailable");
  });

  it("marks file unsupported when patch exceeds 1 MiB limit", () => {
    const largePatch = "a".repeat(MAX_FILE_PATCH_BYTES + 10);
    const res = parseUnifiedPatch(largePatch, {
      path: "huge.ts",
      additions: 10,
      deletions: 0,
    });

    expect(res.parseStatus).toBe("unsupported");
    expect(res.diagnosticCode).toBe("PATCH_TOO_LARGE");
  });

  it("marks file malformed when parsed additions/deletions disagree with GitHub metadata", () => {
    const patch = "@@ -1,1 +1,2 @@\n context\n+new";
    // Patch has 1 addition, 0 deletions. Metadata says 5 additions.
    const res = parseUnifiedPatch(patch, {
      path: "meta-mismatch.ts",
      additions: 5,
      deletions: 0,
    });

    expect(res.parseStatus).toBe("malformed");
    expect(res.diagnosticCode).toContain("METADATA_COUNT_MISMATCH");
  });
});
