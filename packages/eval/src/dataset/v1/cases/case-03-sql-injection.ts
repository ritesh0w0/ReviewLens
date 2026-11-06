import type { EvaluationCase } from "../../schema.js";

export const case03: EvaluationCase = {
  caseId: "CASE-03",
  title: "Unsafe SQL Query Construction via String Interpolation",
  description:
    "Pull request introduces a dynamic search query for customer orders that concatenates raw user-supplied input directly into the SQL query string without parameterization or escaping.",
  language: "typescript",
  purpose: "security_reasoning",
  baseSha: "3333333333333333333333333333333333333331",
  headSha: "3333333333333333333333333333333333333332",
  files: [
    {
      path: "src/db/orders.ts",
      patch: `@@ -12,2 +12,4 @@ export async function findOrders(db: DbClient, customerId: string) {
-  return db.query("SELECT * FROM orders WHERE customer_id = $1", [customerId]);
+  // Quick search optimization
+  const query = "SELECT * FROM orders WHERE customer_id = '" + customerId + "' ORDER BY created_at DESC";
+  return db.query(query);
 }
`,
      baseContent: `export async function findOrders(db: DbClient, customerId: string) {
  return db.query("SELECT * FROM orders WHERE customer_id = $1", [customerId]);
}
`,
      headContent: `export async function findOrders(db: DbClient, customerId: string) {
  // Quick search optimization
  const query = "SELECT * FROM orders WHERE customer_id = '" + customerId + "' ORDER BY created_at DESC";
  return db.query(query);
}
`,
    },
  ],
  expectedFindings: [
    {
      issueId: "CASE-03-ISSUE-1",
      category: "security",
      severity: "critical",
      targetPath: "src/db/orders.ts",
      targetSide: "RIGHT",
      lineRange: { start: 14, end: 16 },
      description:
        "Direct concatenation of `customerId` into SQL query string introduces high-severity SQL Injection vulnerability.",
      rootCause:
        "Replaced parameterized placeholder `$1` with raw string concatenation for a dynamic SQL query.",
      actionability:
        "Reviewer should require parameterized query placeholders (`$1`) with query parameter array to prevent SQL injection.",
      labelStatus: "DRAFT",
    },
  ],
  labelStatus: "DRAFT",
};
