import type { ValidatedFinding } from "../types/findings.js";

export class ConflictingFingerprintError extends Error {
  readonly code = "CONFLICTING_FINGERPRINT";
  readonly fingerprint: string;

  constructor(fingerprint: string, message: string) {
    super(message);
    this.name = "ConflictingFingerprintError";
    this.fingerprint = fingerprint;
  }
}

export function deduplicateFindings(
  findings: readonly ValidatedFinding[],
): ValidatedFinding[] {
  const byFingerprint = new Map<string, ValidatedFinding>();

  for (const finding of findings) {
    const existing = byFingerprint.get(finding.fingerprint);
    if (!existing) {
      byFingerprint.set(finding.fingerprint, finding);
      continue;
    }

    // Verify consistency: code and scope must match
    if (existing.code !== finding.code || existing.scope !== finding.scope) {
      throw new ConflictingFingerprintError(
        finding.fingerprint,
        `Conflicting findings share the same fingerprint ${finding.fingerprint}: codes ('${existing.code}' vs '${finding.code}') or scopes ('${existing.scope}' vs '${finding.scope}') differ`,
      );
    }

    // Identical fingerprint: collapse duplicate
  }

  return Array.from(byFingerprint.values());
}
