import type {
  FindingScope,
  FindingSeverity,
  ValidatedFinding,
} from "../types/findings.js";

const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const SCOPE_ORDER: Record<FindingScope, number> = {
  line: 0,
  file: 1,
  pull_request: 2,
};

export function rankFindings(
  findings: readonly ValidatedFinding[],
): ValidatedFinding[] {
  return [...findings].sort((a, b) => {
    // 1. Severity
    const sevDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sevDiff !== 0) return sevDiff;

    // 2. Scope
    const scopeDiff = SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope];
    if (scopeDiff !== 0) return scopeDiff;

    // 3. File path (lexical ascending)
    const pathA = getFindingPath(a);
    const pathB = getFindingPath(b);
    const pathCmp = pathA.localeCompare(pathB);
    if (pathCmp !== 0) return pathCmp;

    // 4. Line number ascending
    const lineA = getFindingLine(a);
    const lineB = getFindingLine(b);
    if (lineA !== lineB) return lineA - lineB;

    // 5. Finding code (lexical ascending)
    const codeCmp = a.code.localeCompare(b.code);
    if (codeCmp !== 0) return codeCmp;

    // 6. Fingerprint (lexical ascending)
    return a.fingerprint.localeCompare(b.fingerprint);
  });
}

function getFindingPath(f: ValidatedFinding): string {
  if (f.primaryEvidence.kind === "code_line") {
    return f.primaryEvidence.path;
  }
  if (f.primaryEvidence.kind === "file_relationship") {
    return f.primaryEvidence.sourcePath;
  }
  return "";
}

function getFindingLine(f: ValidatedFinding): number {
  if (f.primaryEvidence.kind === "code_line") {
    return f.primaryEvidence.line;
  }
  return 0;
}
