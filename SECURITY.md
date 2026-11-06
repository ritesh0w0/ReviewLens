# Security Policy

ReviewLens takes the security of its code review pipeline, authentication systems, and hosted infrastructure seriously.

---

## Supported Versions

| Version                | Supported          |
| :--------------------- | :----------------- |
| `0.1.x` (Current Main) | :white_check_mark: |
| `< 0.1.0`              | :x:                |

---

## Reporting a Vulnerability

If you discover a security vulnerability in ReviewLens, please **do not create a public GitHub issue**.

Instead, report it responsibly via:

- **GitHub Security Advisories:** Navigate to the repository's Security tab and select "Report a vulnerability".
- **Direct Maintainer Contact:** Email the security maintainer directly at `rites0w0@gmail.com`.

Please include:

1. Detailed description of the vulnerability.
2. Steps or proof-of-concept to reproduce the issue.
3. Potential impact on repositories or tokens.

You will receive an acknowledgment within 48 hours and regular updates on remediation progress.

---

## Security Commitments

- **Zero Secret Commits:** We enforce pre-commit checks and automated CI scanning to prevent sensitive credentials from entering Git history.
- **Diff Evidence Verification:** Candidate AI findings are validated against actual diff hunks before publication to eliminate ungrounded comments.
- **Cryptographic Encryption:** Access tokens are encrypted at rest using AES-256-GCM.
- **Timing-Safe Validation:** All webhook signature and token comparisons use timing-safe constant-time evaluation to prevent timing side-channel attacks.
