import type { EvaluationCase } from "../../schema.js";

export const case05: EvaluationCase = {
  caseId: "CASE-05",
  title: "Deleted Role Authorization Check in Administrative Interceptor",
  description:
    "Pull request removes mandatory admin role validation from the request interceptor during an endpoint cleanup, allowing unauthenticated or non-admin callers to access sensitive administrative routes (LEFT-side deletion regression).",
  language: "typescript",
  purpose: "deletion_reasoning",
  baseSha: "5555555555555555555555555555555555555551",
  headSha: "5555555555555555555555555555555555555552",
  files: [
    {
      path: "src/auth-interceptor.ts",
      patch: `@@ -15,5 +15,2 @@ export function authorizeAdminRequest(req: Request, res: Response, next: NextFunction) {
   const token = extractToken(req);
-  if (!token || !token.roles.includes("admin")) {
-    throw new UnauthorizedException("Admin privilege required");
-  }
   next();
`,
      baseContent: `export function authorizeAdminRequest(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token || !token.roles.includes("admin")) {
    throw new UnauthorizedException("Admin privilege required");
  }
  next();
}
`,
      headContent: `export function authorizeAdminRequest(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  next();
}
`,
    },
  ],
  expectedFindings: [
    {
      issueId: "CASE-05-ISSUE-1",
      category: "security",
      severity: "critical",
      targetPath: "src/auth-interceptor.ts",
      targetSide: "LEFT",
      lineRange: { start: 16, end: 18 },
      description:
        "Removal of role verification check (`!token.roles.includes('admin')`) leaves administrative endpoint unprotected.",
      rootCause:
        "Deleted security guard statement on LEFT side without replacement, introducing an authorization bypass regression.",
      actionability:
        "Reviewer must catch this deletion and request restoring the role check before permitting merge.",
      labelStatus: "DRAFT",
    },
  ],
  labelStatus: "DRAFT",
};
