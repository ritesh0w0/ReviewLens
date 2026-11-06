import type { EvaluationCase } from "../../schema.js";

export const case06: EvaluationCase = {
  caseId: "CASE-06",
  title: "Clean Mathematical Utility Refactoring with Strict Type Guards",
  description:
    "Pull request refactors vector math operations into immutable helper functions with strict type annotations, proper finite number validation, and pure returns. Contains zero defects to measure false-positive resistance.",
  language: "typescript",
  purpose: "false_positive_resistance",
  baseSha: "6666666666666666666666666666666666666661",
  headSha: "6666666666666666666666666666666666666662",
  files: [
    {
      path: "src/math-utils.ts",
      patch: `@@ -5,2 +5,9 @@ export interface Vector2D {
   readonly y: number;
 }
+
+export function addVectors(a: Vector2D, b: Vector2D): Vector2D {
+  if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) {
+    throw new RangeError("Vector coordinates must be finite numbers");
+  }
+  return { x: a.x + b.x, y: a.y + b.y };
+}
`,
      baseContent: `export interface Vector2D {
  readonly x: number;
  readonly y: number;
}
`,
      headContent: `export interface Vector2D {
  readonly x: number;
  readonly y: number;
}

export function addVectors(a: Vector2D, b: Vector2D): Vector2D {
  if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) {
    throw new RangeError("Vector coordinates must be finite numbers");
  }
  return { x: a.x + b.x, y: a.y + b.y };
}
`,
    },
  ],
  expectedFindings: [],
  labelStatus: "DRAFT",
};
