import type { EvaluationCase } from "../../schema.js";

export const case02: EvaluationCase = {
  caseId: "CASE-02",
  title: "Inverted Comparison Logic in Rate Limiter Window Check",
  description:
    "Pull request refactors sliding window counter check but inadvertently inverts the inequality operator, causing requests below the threshold to be blocked and requests exceeding the threshold to be accepted.",
  language: "typescript",
  purpose: "correctness_detection",
  baseSha: "2222222222222222222222222222222222222221",
  headSha: "2222222222222222222222222222222222222222",
  files: [
    {
      path: "src/rate-limiter.ts",
      patch: `@@ -15,5 +15,5 @@ export class SlidingWindowRateLimiter {
   checkLimit(key: string, currentCount: number, maxLimit: number): boolean {
-    if (currentCount >= maxLimit) {
+    if (currentCount <= maxLimit) {
       return false; // reject request
     }
     return true;
`,
      baseContent: `export class SlidingWindowRateLimiter {
  checkLimit(key: string, currentCount: number, maxLimit: number): boolean {
    if (currentCount >= maxLimit) {
      return false; // reject request
    }
    return true;
  }
}
`,
      headContent: `export class SlidingWindowRateLimiter {
  checkLimit(key: string, currentCount: number, maxLimit: number): boolean {
    if (currentCount <= maxLimit) {
      return false; // reject request
    }
    return true;
  }
}
`,
    },
  ],
  expectedFindings: [
    {
      issueId: "CASE-02-ISSUE-1",
      category: "correctness",
      severity: "critical",
      targetPath: "src/rate-limiter.ts",
      targetSide: "RIGHT",
      lineRange: { start: 16, end: 18 },
      description:
        "Inverted rate-limiting condition (`currentCount <= maxLimit`) blocks requests under quota and permits requests exceeding quota.",
      rootCause:
        "Comparison operator was erroneously switched from `>=` to `<=`, reversing the admission control decision.",
      actionability:
        "The reviewer must point out the logic reversal and require restoring `>=` or `>` so admission control functions as intended.",
      labelStatus: "DRAFT",
    },
  ],
  labelStatus: "DRAFT",
};
