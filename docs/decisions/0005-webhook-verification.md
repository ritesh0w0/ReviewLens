# D-005 — HMAC verification and Octokit

Status: Accepted

Decision:
Implement webhook HMAC verification explicitly and use Octokit for
GitHub API calls.

Reason:
We want the signature-verification boundary to be understandable
and testable while avoiding unnecessary low-level API plumbing.

Alternatives:
A webhook verification helper library instead of our own verifier.
