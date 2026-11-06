import type { EvaluationCase } from "../../schema.js";

export const case04: EvaluationCase = {
  caseId: "CASE-04",
  title: "Unclosed File Stream and Unhandled Rejection in Exporter",
  description:
    "Pull request introduces a bulk report export function that opens a file write stream but omits `try...finally` resource cleanup, causing file descriptor leaks and orphaned unhandled promise rejections on network fetch failures.",
  language: "typescript",
  purpose: "reliability_reasoning",
  baseSha: "4444444444444444444444444444444444444441",
  headSha: "4444444444444444444444444444444444444442",
  files: [
    {
      path: "src/exporter.ts",
      patch: `@@ -8,0 +8,9 @@ import * as fs from "node:fs";
+export async function exportReport(outputPath: string, urls: string[]): Promise<void> {
+  const outStream = fs.createWriteStream(outputPath);
+  for (const url of urls) {
+    const res = await fetch(url);
+    const data = await res.text();
+    outStream.write(data);
+  }
+  outStream.end();
+}
`,
      baseContent: `import * as fs from "node:fs";
`,
      headContent: `import * as fs from "node:fs";

export async function exportReport(outputPath: string, urls: string[]): Promise<void> {
  const outStream = fs.createWriteStream(outputPath);
  for (const url of urls) {
    const res = await fetch(url);
    const data = await res.text();
    outStream.write(data);
  }
  outStream.end();
}
`,
    },
  ],
  expectedFindings: [
    {
      issueId: "CASE-04-ISSUE-1",
      category: "reliability",
      severity: "high",
      targetPath: "src/exporter.ts",
      targetSide: "RIGHT",
      lineRange: { start: 10, end: 17 },
      description:
        "File stream created with `fs.createWriteStream` is not closed in a `try...finally` block, leading to file descriptor leak if `fetch` throws.",
      rootCause:
        "Resource acquisition is not paired with a guaranteed disposal block (`try/finally`), and network errors will abort before `outStream.end()`.",
      actionability:
        "The reviewer should advise wrapping the stream write loop in `try...finally { outStream.close(); }` or handling stream error events.",
      labelStatus: "DRAFT",
    },
  ],
  labelStatus: "DRAFT",
};
