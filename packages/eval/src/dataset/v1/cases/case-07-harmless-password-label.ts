import type { EvaluationCase } from "../../schema.js";

export const case07: EvaluationCase = {
  caseId: "CASE-07",
  title: "Harmless UI Dictionary Containing 'password' and 'secret' Labels",
  description:
    "Pull request introduces user-interface string constants containing words commonly targeted by crude pattern matchers (such as 'password' and 'secret'), but represents entirely safe, non-sensitive localization text with zero defects.",
  language: "typescript",
  purpose: "false_positive_resistance",
  baseSha: "7777777777777777777777777777777777777771",
  headSha: "7777777777777777777777777777777777777772",
  files: [
    {
      path: "src/ui/form-labels.ts",
      patch: `@@ -1,3 +1,7 @@
 export const FORM_TITLES = {
   login: "Please sign in to your workspace",
+  passwordLabel: "Enter your current account password",
+  passwordConfirmationLabel: "Confirm your new password",
+  secretQuestionPrompt: "Select a secret recovery question",
+  helpText: "Passwords must contain at least 12 characters",
 };
`,
      baseContent: `export const FORM_TITLES = {
  login: "Please sign in to your workspace",
};
`,
      headContent: `export const FORM_TITLES = {
  login: "Please sign in to your workspace",
  passwordLabel: "Enter your current account password",
  passwordConfirmationLabel: "Confirm your new password",
  secretQuestionPrompt: "Select a secret recovery question",
  helpText: "Passwords must contain at least 12 characters",
};
`,
    },
  ],
  expectedFindings: [],
  labelStatus: "DRAFT",
};
