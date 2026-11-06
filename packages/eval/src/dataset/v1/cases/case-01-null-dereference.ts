import type { EvaluationCase } from "../../schema.js";

export const case01: EvaluationCase = {
  caseId: "CASE-01",
  title: "Missing Null/Undefined Handling in User Profile Parsing",
  description:
    "Pull request introduces a helper function that directly accesses deep properties of an optional nested object without null/undefined validation, causing a runtime TypeError for users with incomplete profiles.",
  language: "typescript",
  purpose: "correctness_detection",
  baseSha: "1111111111111111111111111111111111111111",
  headSha: "1111111111111111111111111111111111111112",
  files: [
    {
      path: "src/user-service.ts",
      patch: `@@ -10,3 +10,12 @@ export interface UserRecord {
   id: string;
   email: string;
+  profile?: {
+    details?: {
+      displayName: string;
+    };
+  };
 }
+
+export function getUserDisplayName(user: UserRecord): string {
+  return user.profile.details.displayName.trim();
+}
`,
      baseContent: `export interface UserRecord {
  id: string;
  email: string;
}
`,
      headContent: `export interface UserRecord {
  id: string;
  email: string;
  profile?: {
    details?: {
      displayName: string;
    };
  };
}

export function getUserDisplayName(user: UserRecord): string {
  return user.profile.details.displayName.trim();
}
`,
    },
  ],
  expectedFindings: [
    {
      issueId: "CASE-01-ISSUE-1",
      category: "correctness",
      severity: "high",
      targetPath: "src/user-service.ts",
      targetSide: "RIGHT",
      lineRange: { start: 18, end: 20 },
      description:
        "Direct property access on optional user.profile.details without null/undefined check will throw TypeError if profile or details is missing.",
      rootCause:
        "Type definition declares profile and details as optional, but accessor method assumes they are always present and defined.",
      actionability:
        "The reviewer should recommend optional chaining (`user.profile?.details?.displayName?.trim() ?? ''`) or guard checks before property dereferencing.",
      labelStatus: "DRAFT",
    },
  ],
  labelStatus: "DRAFT",
};
