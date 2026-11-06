# ReviewLens — M4 Hosted LLM Integration, Security, Validation & Reliability

## 1. Overview & Architecture

Milestone **M4** integrates hosted Large Language Model (LLM) analysis into ReviewLens, working in concert with the deterministic rule engine established in M3.

ReviewLens adheres to an **evidence-first** paradigm: LLM suggestions are treated as untrusted hypotheses. Every candidate finding produced by an AI model must pass through a strict **7-stage validation pipeline**—verifying schema, path membership, commentable diff line coordinates, verbatim evidence quoting against actual source code, confidence filtering, markdown/secret sanitization, and SHA-256 evidence fingerprinting—before it can be merged with deterministic findings and submitted as advisory pull-request comments.

```text
    PreparedReviewInput (from M2 Diff Pipeline)
                         │
                         ├────────────────────────────────────────┐
                         ▼                                        ▼
             Deterministic Rule Engine (M3)              Public Repo Gate Check
                         │                                        │ (Blocks private repos)
                         │                                        ▼
                         │                             Sensitive Path & Secret Filter
                         │                                        │ (Redacts secrets, drops keys)
                         │                                        ▼
                         │                             Bounded Source Context Fetch
                         │                                        │ (Max 256 KiB/file, 2 MiB aggregate)
                         │                                        ▼
                         │                             Chunker & Token Budget Packing
                         │                                        │ (Gemini 16k, Groq 3k, max 8 chunks)
                         │                                        ▼
                         │                             Model Router with Sticky Fallback
                         │                                        │ (Rate limiter & Circuit breaker)
                         │                                        ▼
                         │                             Hosted Model Invocation
                         │                               (Gemini 3.5/3.8 / Groq GPT-OSS-120B)
                         │                                        │
                         │                                        ▼
                         │                             7-Stage Candidate Validator
                         │                                        │ (Verbatim quote, commentable line)
                         │                                        ▼
                         │                              Validated AI Findings
                         │                                        │
                         └───────────────────┬────────────────────┘
                                             ▼
                             Combined Finding Pool (M3 + M4)
                                             │
                                             ▼
                             Deduplication & Canonical Hashing
                                             │
                                             ▼
                             6-Tier Prioritization & Ranking
                                             │
                                             ▼
                             Inline Presentation Capping (0–8)
                                             │
                                             ▼
                             Reconciled GitHub Review Publishing
```

---

## 2. Models, Free-Tier Budgets & Profiles

ReviewLens strictly operates on a **₹0 budget / Free Tier** guarantee. It uses official SDKs dynamically loaded without leaking vendor dependencies into `@reviewlens/core`:

- `@google/genai` (pinned `2.32.0`)
- `groq-sdk` (pinned `1.6.0`)

### 2.1 Pinned Model Identifiers

Models are strictly pinned to immutable, non-floating identifiers:

1. `gemini-3.8-flash` (Google GenAI)
2. `gemini-3.5-flash-lite` (Google GenAI)
3. `openai/gpt-oss-120b` (Groq SDK)

### 2.2 Deployment Profiles

- **`development`**:
  - Primary: `gemini-3.5-flash-lite`
  - Fallback: `openai/gpt-oss-120b` (Groq)
- **`demo`**:
  - Primary: `gemini-3.8-flash`
  - Fallback 1: `gemini-3.5-flash-lite`
  - Fallback 2: `openai/gpt-oss-120b` (Groq)

### 2.3 Operating Token Budgets & Rate Ceilings

Token budgets and rate limits are conservatively set with an 80% safety margin:

| Model                   | Target Input Tokens | Hard Cap Input | Max Output Reserve | Conservative Ceilings               |
| :---------------------- | :------------------ | :------------- | :----------------- | :---------------------------------- |
| `gemini-3.8-flash`      | 16,000              | 20,000         | 1,536              | 4 RPM, 200k TPM, 16 RPD             |
| `gemini-3.5-flash-lite` | 16,000              | 20,000         | 1,536              | 12 RPM, 200k TPM, 400 RPD           |
| `openai/gpt-oss-120b`   | 3,000               | 3,500          | 1,024              | 24 RPM, 6.4k TPM, 160k TPD, 800 RPD |

---

## 3. Security and Privacy Safeguards

AI analysis enforces defense-in-depth security before any external API is contacted:

1. **Public Repository Gate (`public-repo-gate.ts`)**:
   - Strictly restricts AI code review to public repositories (`isPrivate: false` or `visibility: "public"`).
   - Private or unverified repositories immediately fail closed with status `NOT_ELIGIBLE`. Private code is never transmitted to external LLMs.

2. **Sensitive Path Filter (`sensitive-path-filter.ts`)**:
   - Excludes configuration, credentials, keyrings, and memory dumps matching patterns like `.env*`, `.ssh/**`, `*.key`, `*.pem`, `*.sqlite`, `*.dump`, `secrets/**`.
   - Inspects both current `path` and previous `oldPath` on file renames.

3. **High-Confidence Secret Scanner (`secret-scanner.ts`)**:
   - Detects private key block headers (`-----BEGIN ... PRIVATE KEY-----`) and triggers immediate `exclude_file` action.
   - Detects and redacts inline tokens (GitHub PATs, AWS keys, Slack tokens, Google API keys, database connection credentials, Bearer/Basic auth headers) with `[REDACTED_SECRET]`.
   - Sanitizes candidate finding messages to ensure LLM responses never echo secrets back into GitHub comments.

4. **Unicode Sanitizer (`unicode-sanitizer.ts`)**:
   - Neutralizes CVE-2021-42574 Trojan Source Bidi overrides (`\u202A`–`\u202E`, `\u2066`–`\u2069`), Unicode tag characters, and invisible zero-width control characters.

---

## 4. Source Context Fetching and Token Chunker

1. **Bounded Source Fetcher (`source-fetcher.ts`)**:
   - Fetches file content at the exact immutable `headSha` from GitHub.
   - Enforces a single-file size ceiling of 256 KiB and aggregate ceiling of 2 MiB per pull request.
   - Caps context files to at most 30 files per pull request.
   - Extracts a bounded window of ±30 lines around changed lines (`extractLineWindow`).

2. **Context Chunker (`chunker.ts`)**:
   - Organizes changed files into review units with single-chunk line ownership (each changed line belongs to exactly one chunk).
   - Packs units into chunks based on target token budgets (16,000 for Gemini, 3,000 for Groq).
   - Caps total chunks per pull request run at 8.
   - Supports dynamic unit repacking when falling back to lower-budget models like Groq.

---

## 5. 7-Stage Candidate Finding Validation Pipeline

Raw findings returned by the model pass through seven deterministic validation stages in `candidate-validator.ts`:

1. **Completion Validation**: Verifies that the model finished with status `success` and was not aborted, truncated, or blocked by content safety filters.
2. **Schema Validation**: Validates JSON structure using Zod (`RawAICandidateSchema`), enforcing line >= 1, confidence between 0.0 and 1.0, allowed categories (`correctness`, `security`, `reliability`, `performance`, `resource_usage`), allowed severities, and max 5 findings per chunk.
3. **Path Membership Validation**: Rejects any finding referencing a file not included in the reviewed chunk.
4. **Commentable Line Validation**: Verifies that the target line and diff side (`LEFT` or `RIGHT`) match the M2 commentable line index.
5. **Verbatim Evidence Quote Validation**: Verifies that the provided `evidence_quote` matches the actual line content from the diff snapshot.
6. **Confidence & Markdown Sanitization**: Filters out findings below the confidence threshold (default 0.70). Neutralizes GitHub `@mentions` and HTML tags, and redacts any residual secret occurrences.
7. **Provenance & Fingerprint Generation**: Generates `ValidatedFinding` using fixed detector origin (`reviewlens-ai` v1.0) and computes stable SHA-256 finding fingerprint. Discards untrusted raw quotes.

---

## 6. Reliability, Rate Limiting & Resilience

1. **Error Classification (`errors.ts`)**:
   - Distinguishes transient per-minute rate limits (`RATE_LIMIT_RPM`) from daily quota exhaustion (`RATE_LIMIT_RPD`).
   - Identifies timeouts, network resets, 5xx server errors, authentication errors, and content safety refusals.

2. **Circuit Breaker (`circuit-breaker.ts`)**:
   - Maintained per model instance (`CLOSED`, `OPEN`, `HALF_OPEN`).
   - Trips to `OPEN` after 3 consecutive failures.
   - Automatically probes with `HALF_OPEN` after a 30-second cooldown.

3. **Model Rate Limiter (`rate-limiter.ts`)**:
   - Atomic reservation of request and token capacity against conservative rate ceilings.
   - Tracks 60-second sliding windows and 24-hour daily quotas.

4. **Sticky Fallback Routing (`model-router.ts`)**:
   - When a model encounters rate limits or circuit trip, switches to the next fallback model in the profile.
   - The fallback is sticky for the remainder of the review run to avoid thrashing between providers.

---

## 7. Database Persistence & Lifecycle

1. **Schema Models (`prisma/schema.prisma`)**:
   - `AIReviewExecution`: Tracks overall AI review run lifecycle, profile, models, chunks, token aggregates, and validation counts.
   - `AIReviewChunk`: Tracks individual chunk status, token counts, and file paths.
   - `AIInferenceAttempt`: Logs every inference attempt with model, latency, status, and error classification.

2. **ReviewRun Integration**:
   - Updates `tokensIn` and `tokensOut` on `ReviewRun`.
   - Incorporates AI coverage notices into the GitHub review summary body (e.g., `AI review: 1 chunk(s) analyzed using gemini-3.5-flash-lite. 1 candidate finding(s) validated against code changes.`).
   - If AI review is disabled or fails, the workflow gracefully falls back to deterministic rules without disrupting review delivery.
