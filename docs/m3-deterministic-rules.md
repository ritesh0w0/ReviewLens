# ReviewLens — M3 Deterministic Rule Engine & GitHub Review Publishing

## 1. Overview & Architecture

The **M3 Deterministic Rule Engine and GitHub Review Publishing Pipeline** connects the structured pull-request diff representations prepared in M2 to evidence-validated review findings, deterministic prioritization, and safe GitHub advisory review publication.

In ReviewLens, all findings—whether produced by deterministic rules or future LLM analyses—are treated as unproven claims. They must pass independent evidence validation, configuration hashing, versioned fingerprinting, deduplication, and presentation capping before being submitted as GitHub comments.

```text
    PreparedReviewInput (from M2 Diff Pipeline)
                         │
                         ▼
        Project RuleContext (files, additions, PR metrics)
                         │
                         ▼
     Deterministic Rule Engine (Registry: forbid_regex,
        require_companion, max_pr_size)
                         │
                         ▼
             Candidate Findings (raw claims)
                         │
                         ▼
           Evidence Validator (independent verification:
              line content hash, side, commitSha, file state)
                         │
                         ▼
        Semantic Digest & Versioned Fingerprints (v1)
                         │
                         ▼
         Deduplication (collapse duplicates, reject conflicts)
                         │
                         ▼
       Prioritization & Presentation Planner (0-8 inline cap,
          severity > scope > path > line > code > fp,
          same-anchor grouping)
                         │
                         ▼
     GitHub Advisory Review Publishing (event: COMMENT)
     - Marker reconciliation before M2 and before POST
     - Batched review creation
     - Controlled 422 coordinate fallback (summary-only)
     - Ambiguous network recovery
     - Atomic ReviewRun update (status: SUCCEEDED)
```

---

## 2. Rule Engine Architecture

The rule engine is implemented in `@reviewlens/core` as a pure, synchronous, deterministic function with no I/O, database, or network side effects.

### 2.1 Registry & Contracts

The engine enforces an explicit allowlist registry. Unknown or unregistered rule types throw `UnknownRuleTypeError`.

Supported deterministic rules in M3:

1. `forbid_regex`: Scans added lines in eligible files for forbidden regular expressions using safe RE2 syntax.
2. `require_companion`: Enforces that changes to files with a given suffix require corresponding companion changes in the same PR.
3. `max_pr_size`: Enforces PR-level size limits on total changed files and total line changes.

### 2.2 Execution Semantics & Resource Limits

- Rules execute serially in exact `.reviewlens.yml` configuration order.
- Hard limits prevent denial-of-service from runaway configurations:
  - `MAX_CONFIGURED_RULES = 50`
  - `MAX_FINDINGS_PER_RULE_INSTANCE = 500`
  - `MAX_TOTAL_CANDIDATE_FINDINGS = 1000`
- **Fail-Closed Execution**: If an unexpected exception occurs during any rule's evaluation, the engine aborts immediately with `RuleExecutionError`, preventing partial, inconsistent, or corrupted reviews.
- **Coverage Status**:
  - `complete`: All eligible files and lines were successfully inspected.
  - `partial`: One or more eligible files had unparseable diffs (`parseStatus !== "parsed"`). The review proceeds with visible coverage warning banners.
  - `no_rules`: No rules were enabled.

---

## 3. Supported Deterministic Rules

### 3.1 `forbid_regex`

- **Target**: Evaluates additions only (`+` lines) in eligible files. Deletions and unchanged context lines are never flagged.
- **Engine**: Uses `re2js` for linear-time regex matching. Catastrophic backtracking is prevented at compile time by validating patterns against RE2 syntax in `config-loader.ts`.
- **Match Offsets**: Computes character start and end offsets within the line for grounded evidence.
- **Evidence Integrity**: Never echoes matching line contents in finding messages or logs to prevent secret leakage. Evidence contains a SHA-256 hash of the line content for grounding validation.
- **Default Severity**: `medium` (configurable to `info`, `low`, `medium`, `high`, `critical`).

### 3.2 `require_companion`

- **Policy**: Implements Option A (Same-PR Companion Policy). If an eligible source file ending with `source_suffix` is changed, a corresponding file ending with `companion_suffix` must also be changed in the same pull request.
- **File Matching**: Strips `source_suffix` and appends `companion_suffix`. Checks whether the companion exists in the complete PR changed-files list (not just eligible files).
- **Active Companions**: A deleted companion (`status: "removed"`) does not satisfy the requirement. Renamed companions are tracked by their target path (`filename`).
- **Default Severity**: `low`.

### 3.3 `max_pr_size`

- **Scope**: Pull-request level metric rule (`scope: "pull_request"`).
- **Thresholds**: Supports `max_files` (total changed files in PR) and `max_total_changes` (total additions + deletions). At least one threshold must be specified.
- **Strict Violation**: Evaluates `count > max` (equal values do not violate).
- **Consolidation**: If both thresholds are violated, a single consolidated finding is produced.
- **Default Severity**: `low`.

---

## 4. Evidence Validation & Stable Fingerprints

### 4.1 Independent Evidence Validation

Candidate findings generated by rules must be validated against `RuleContext` before they can be considered:

- **Code Line Evidence**: Verifies that the file is eligible and parsed, the hunk exists, the line exists on the specified diff side (`RIGHT` for additions), the commit SHA matches the PR `headSha`, and the SHA-256 hash of the line content matches the evidence hash.
- **File Relationship Evidence**: Verifies that the source file is eligible and that the companion existence flag accurately reflects the PR file list.
- **Pull Request Metric Evidence**: Verifies that metric values (changed files, total changes) exactly match the PR metadata.

### 4.2 Semantic Configuration Digests

Each rule configuration item is hashed using canonical recursive key sorting into a SHA-256 digest (`configDigest`). Changes to comments or insignificant formatting do not invalidate digests, while changes to patterns or thresholds alter the digest.

### 4.3 Versioned Fingerprints (`FINGERPRINT_VERSION = 1`)

Each finding receives a deterministic, stable fingerprint:

- Line findings: Hashed from `repoId`, `origin.ruleId`, `origin.configDigest`, `primaryEvidence.path`, `primaryEvidence.lineHash`, and `matchRange`.
- Line finding fingerprints are **position-independent**: edits elsewhere in the file that shift the line number do not alter the fingerprint because the line content hash is used instead of the line number.
- PR/File findings: Hashed from `repoId`, `origin.ruleId`, `origin.configDigest`, and primary evidence properties.

### 4.4 Deduplication

- Duplicate findings with identical fingerprints are collapsed into a single finding.
- If two candidate findings share the same fingerprint but have conflicting attributes (e.g., mismatched title, severity, or evidence), deduplication rejects them with `ConflictingFingerprintError`.

---

## 5. Prioritization, Presentation Planning & Payload Generation

### 5.1 Deterministic Ranking Comparator

Findings are sorted deterministically using a 6-tier comparator:

1. `severity`: `critical` > `high` > `medium` > `low` > `info`
2. `scope`: `line` > `file` > `pull_request`
3. `path`: alphabetical order
4. `line`: ascending line number (non-line findings treat line as `0`)
5. `code`: alphabetical order
6. `fingerprint`: alphabetical tiebreaker (guarantees strict total order)

The ranking function is pure and returns a new sorted array without mutating input.

### 5.2 Presentation Planning & Cap Enforcement

- GitHub pull requests should not be overwhelmed with bot comments. The system enforces an inline comment cap of `0-8` (default: 8, configured via `review.max_inline_comments`).
- Findings sharing the exact same anchor (`path + side + line + commitSha`) are grouped into a single `InlineCommentGroup`.
- If the cap is `0`, all line findings are presented in the top-level review summary rather than posted as inline comments.
- Line findings exceeding the cap are suppressed and counted in the summary statistics.
- File-level and PR-level findings are always presented in the review summary.

### 5.3 Payload Formatting & Safety

- **Marker**: Every review summary body ends with the immutable marker:
  `<!-- reviewlens:run:<RUN_ID> -->`
- **Bounds**: Summary bodies are capped at 32 KiB; inline comment bodies at 4 KiB. Marker truncation is strictly prevented.
- **Sanitization**: All markdown content neutralizes GitHub `@mentions` (using zero-width spaces `@\u200B`) and sanitizes dangerous HTML tags (`<script>` and raw tags).

---

## 6. GitHub Review Publishing, Recovery & Lifecycle

### 6.1 Publication Semantics

- ReviewLens publishes batched reviews via `POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews` with:
  - `event: "COMMENT"` (ReviewLens is strictly advisory: it never approves, requests changes, or blocks merging).
  - Explicit `commit_id: headSha`.
  - Array of inline comments.
  - Top-level summary body with marker.
- **Zero-Finding Optimization**: If zero findings are detected and coverage is `complete`, ReviewLens transitions directly to `SUCCEEDED` without posting an empty GitHub review. If coverage is `partial`, an advisory review with coverage warnings is published.

### 6.2 Double Marker Reconciliation

To prevent duplicate review postings across worker retries and overlapping deliveries:

1. **First Check**: Immediately before diff retrieval in M2.
2. **Second Check**: Immediately before `createReview` POST.

If a review matching `<!-- reviewlens:run:<RUN_ID> -->` already exists on the PR, submitted by the authenticated GitHub App on the current `headSha`:

- The existing review is recovered.
- `ReviewRun` records the `githubReviewId` and marks `SUCCEEDED`.
- Duplicate POST is avoided.

### 6.3 Controlled 422 Fallback

If GitHub rejects inline comments with HTTP 422 (e.g., line coordinates out of range or unmappable hunk):

1. `isInlineCoordinate422Error` detects coordinate errors.
2. Freshness and claim token are re-verified.
3. Marker reconciliation is checked.
4. A fallback summary-only review (`comments: []`) is submitted with all findings presented in the summary text and an advisory notice.
5. Generic 422 errors (e.g. abuse rate limits) fail closed without fallback.

### 6.4 Ambiguous Network Recovery

If an ambiguous network error (ETIMEDOUT, ECONNRESET, 502, 503, 504) occurs during review creation:

- Reconciliation checks if the review actually reached GitHub.
- If recovered, `SUCCEEDED` is recorded.
- If not recovered, the error is re-thrown for pg-boss retry.

### 6.5 ReviewRun Lifecycle State Machine

`ReviewRun.status` remains `RUNNING` throughout diff retrieval, parsing, rule execution, evidence validation, and ranking. Terminal status `SUCCEEDED` is set only upon verified review publication or zero-finding complete coverage.
