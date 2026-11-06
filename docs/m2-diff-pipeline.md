# ReviewLens — M2 Pull-Request Diff Pipeline

## 1. Overview & Architecture

The **M2 Pull-Request Diff Pipeline** retrieves, filters, parses, and maps GitHub pull-request code changes into structured, trustworthy in-memory representations (`PreparedReviewInput`) for downstream deterministic rules (M3) and AI-assisted semantic analysis (M4).

The pipeline enforces an evidence-first principle: model-generated comments are unproven claims that must be validated against real diff lines before being published.

```text
ReviewRun (headSha, baseSha)
             │
             ▼
     Fetch PR Metadata
             │
             ▼
     Verify Expected Revision
             │
             ▼
    Load .reviewlens.yml
    (from exact baseSha)
             │
             ▼
   Paginate Changed Files (per_page: 100)
             │
             ▼
     Path Filtering (picomatch)
             │
             ▼
 Parse Eligible File Patches (Strict Parser)
             │
             ▼
 Build Commentable Line Index (LEFT/RIGHT)
             │
             ▼
  Re-verify PR Revision Freshness
             │
             ▼
  Validate Snapshot Completeness
             │
             ▼
    PreparedReviewInput (in-memory)
```

### 1.1 Revision Immutability & Dual-SHA Identity

A `ReviewRun` is strictly bound to two immutable commit SHAs:

- **`headSha`**: The exact commit being reviewed. All commentable-line mappings and findings bind to this SHA.
- **`baseSha`**: The target-side revision where `.reviewlens.yml` is fetched.

If a developer pushes a new commit while the worker is retrieving or processing diffs, the worker detects that `headSha` or `baseSha` has changed and marks the run `SUPERSEDED`. The old run is never silently retargeted to the newer commit.

### 1.2 Pagination & The 3,000-File Limit

GitHub's `/repos/{owner}/{repo}/pulls/{pull_number}/files` endpoint paginates with `per_page=100` and enforces a hard ceiling of 3,000 files.

- The pipeline fetches all pages sequentially.
- If a PR reports more than 3,000 files, the pipeline halts immediately with `EXCEEDS_FILE_LIMIT`.
- Partial retrievals are strictly rejected (`INCOMPLETE_CHANGED_FILES`).

### 1.3 Strict Unified Diff Parser

The diff parser is an in-house, zero-dependency parser that maintains separate old and new line cursors:

- **Context (` `)**: Increments both `oldCursor` and `newCursor`.
- **Addition (`+`)**: Increments only `newCursor`.
- **Deletion (`-`)**: Increments only `oldCursor`.
- **No-newline marker (`\ No newline at end of file`)**: Treated as metadata; does not increment line counters.
- **Hunk counts**: Header declared counts must exactly match consumed lines; otherwise marked `malformed`.
- **Limits**: Files exceeding 1 MiB patch size are marked `unsupported`. Combined diff syntax (`@@@`) is marked `unsupported`.
- **Consistency**: Parsed addition/deletion totals are cross-checked against GitHub metadata.

### 1.4 Commentable-Line Mapping

Converts parsed diff coordinates into modern GitHub review locations:

- **Additions**: `side: "RIGHT"`, `line: newLine`, `isChanged: true`.
- **Context**: `side: "RIGHT"`, `line: newLine`, `isChanged: false`.
- **Deletions**: `side: "LEFT"`, `line: oldLine`, `isChanged: true`.

Each location is bound to `commitSha: headSha`. Coordinate collisions are detected and rejected.

---

## 2. `.reviewlens.yml` Repository Configuration

### 2.1 Base-Commit Security Boundary

The configuration file `.reviewlens.yml` must reside at the repository root and is **always** fetched using the exact `baseSha`:

```http
GET /repos/{owner}/{repo}/contents/.reviewlens.yml?ref={baseSha}
```

**Why?** If `.reviewlens.yml` were read from the PR branch (`headSha`), an author could weaken review rules or exclude sensitive folders in the very PR being reviewed. Reading from `baseSha` ensures that repository policies remain owned by the target branch.

### 2.2 Configuration Schema

```yaml
version: 1

paths:
  include:
    - "src/**"
    - "packages/*/src/**"

  exclude:
    - "src/**/*.generated.ts"
    - "dist/**"
    - "vendor/**"
```

- **`version`**: Must be integer `1`.
- **`paths.include`** _(optional)_: List of glob patterns. If omitted, all repository paths are eligible by default. If present, a path must match at least 1 pattern.
- **`paths.exclude`** _(optional)_: List of glob patterns. **Exclusion always takes precedence over inclusion.**

### 2.3 Limits & Pattern Rules

- Maximum file size: **32 KiB**.
- Maximum patterns: **100** per list.
- Maximum pattern length: **256** characters.
- Path traversal (`..`), absolute paths (`/`), NUL characters (`\0`), and negation (`!`) are rejected.

### 2.4 Renames and Deleted Files

- When a file is renamed (`previous_filename` $\to$ `filename`), exclude patterns are evaluated against **both** old and new paths. If either matches an exclude rule, the file is excluded (preventing exclusion bypass by moving files into included directories).
- For deleted files, the old path is evaluated against exclude patterns.

### 2.5 Fallback Policy

- **HTTP 404 (Missing)**: Fall back to safe defaults (`include: undefined`, `exclude: []`) with status `missing`.
- **Invalid YAML / Schema Failure / Invalid Glob**: Fall back to safe defaults with status `invalid_defaulted` and record warning diagnostics.
- **HTTP 403 / 5xx / Network Error**: Propagated as real errors; never swallowed as missing configuration.

---

## 3. GitHub App Permissions

### 3.1 Permissions Summary

| Permission        | Level    | Reason                                                                                  |
| ----------------- | -------- | --------------------------------------------------------------------------------------- |
| **Pull requests** | Write    | Retrieve PR metadata, paginate changed files, and publish reviews (M1/M3).              |
| **Metadata**      | Read     | Default GitHub App repository access.                                                   |
| **Contents**      | **Read** | **Required by M2** to fetch `.reviewlens.yml` at specific commit refs via Contents API. |

> [!IMPORTANT]
> **Manual Action Required:** The GitHub App manifest and settings in GitHub must include `Contents: Read`. Repository installation owners will need to approve this permission update before the app can read repository configuration.

---

## 4. Failure Modes and Handling

| Situation                                       | Outcome / Behavior                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| Head or base SHA changes during processing      | `ReviewRun` status $\to$ `SUPERSEDED`, processing stops                               |
| PR closed or merged during processing           | `ReviewRun` status $\to$ `SKIPPED`, processing stops                                  |
| PR has > 3,000 files                            | Fails with `EXCEEDS_FILE_LIMIT`                                                       |
| Aggregate patches exceed 10 MiB                 | Fails with `EXCEEDS_AGGREGATE_DIFF_LIMIT`                                             |
| File patch missing (binary / large diff)        | File marked `patch_unavailable`; metadata retained, no locations                      |
| File patch > 1 MiB                              | File marked `unsupported`; no locations generated                                     |
| Malformed hunk / count mismatch                 | File marked `malformed`; no locations generated                                       |
| GitHub primary / secondary rate limit (403/429) | Classified as **transient**; worker retries with backoff                              |
| GitHub permission denied (403)                  | Classified as **permanent**; halts retry cycles                                       |
| Review comment publication in M2                | **Zero reviews published**; M2 diff pipeline produces in-memory structured input only |
