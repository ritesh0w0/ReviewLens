# ReviewLens M5 — Developer Manual Testing Guide

This guide describes how the project owner can run manual and sandbox tests of the **M5 Evaluation Framework** against actual pull requests in a GitHub repository.

---

## 1. Prerequisites

Before testing with a live GitHub sandbox repository, ensure the following are configured in your development environment:

1. **ReviewLens Services Running**:
   - PostgreSQL 16+ running locally or in Docker (`docker compose up -d postgres`).
   - Database migrated: `npm run prisma:migrate`.
   - API server running: `npm run dev --workspace=@reviewlens/api`.
   - Worker running: `npm run dev:worker --workspace=@reviewlens/api`.
2. **GitHub App Installed on Sandbox Repository**:
   - Webhook URL pointing to ReviewLens (`/api/v1/webhook`).
   - GitHub App configured with Pull Request (Read & Write) permissions.
   - Private key and App ID configured in `.env`.
3. **LLM Provider API Key (Optional)**:
   - For offline evaluation: **No keys required** (₹0 budget).
   - For generating live M4 candidate runs: `GEMINI_API_KEY` or `GROQ_API_KEY` configured in `.env`.

---

## 2. Test Execution Workflows

### Workflow A: Offline Benchmark Evaluation (Zero Cost / Safe)

Run the automated benchmark suite against synthetic benchmark dataset v1 without making any network calls:

```bash
# 1. Run evaluation against the default deterministic baseline
npm run eval:m5

# 2. Run evaluation on baseline fixture and inspect console summary
npm run eval:m5 -- --input fixtures/sample-baseline-run.json

# 3. Generate detailed Markdown and JSON reports in eval-results/
npm run eval:m5 -- --input fixtures/sample-baseline-run.json --out-md eval-results/baseline.md --out-json eval-results/baseline.json

# 4. Run candidate run with regression diff against baseline
npm run eval:m5 -- --input fixtures/sample-candidate-run.json --baseline eval-results/baseline.json --out-md eval-results/candidate.md --out-json eval-results/candidate.json
```

---

### Workflow B: Sandbox Testing on Real GitHub Pull Requests

To test ReviewLens on real pull requests and evaluate findings against human ground truth:

#### Step 1: Create Test Pull Requests in Sandbox Repo

Create branches in your sandbox repository corresponding to real-world review scenarios:

- **Scenario 1 (Security defect)**: Raw SQL concatenation or unvalidated query parameter.
- **Scenario 2 (Correctness defect)**: Boundary operator bug (`<` instead of `<=`) or unhandled null dereference.
- **Scenario 3 (Clean refactor)**: Refactoring function signatures or extracting constants (0 genuine issues).
- **Scenario 4 (Resource leak)**: Stream or file handle opened without `try/finally` or unhandled promise rejection.

#### Step 2: Ingest Run Findings into Evaluation Harness

When ReviewLens completes a review for a sandbox pull request, retrieve the accepted findings from the ReviewRun record in PostgreSQL:

```sql
SELECT "id", "status", "findingsCount", "executionTimeMs"
FROM "ReviewRun"
ORDER BY "createdAt" DESC
LIMIT 5;

SELECT "findings"
FROM "ReviewRunFinding"
WHERE "reviewRunId" = '<your-review-run-id>';
```

Format the findings into an `EvaluationRunInput` JSON file (following `packages/eval/fixtures/sample-baseline-run.json` structure):

```json
{
  "runId": "eval-run-sandbox-20261106-01",
  "datasetId": "reviewlens-benchmark-v1",
  "datasetVersion": "1.0.0",
  "evaluator": "developer-name",
  "timestamp": "2026-11-06T02:00:00.000Z",
  "provider": "google",
  "modelId": "gemini-3.5-flash-lite",
  "promptVersion": "1.0",
  "schemaVersion": "1.0",
  "caseResults": [ ... ]
}
```

#### Step 3: Run Evaluation and Inspect Markdown Report

```bash
npm run eval:m5 -- --input eval-results/my-sandbox-run.json --out-md eval-results/sandbox-report.md --out-json eval-results/sandbox-report.json
```

Open `eval-results/sandbox-report.md` in your markdown previewer.

---

### Workflow C: Human Adjudication Override

When candidate findings are ambiguous or dispute automated heuristics:

1. Create an adjudication file (e.g. `eval-results/my-adjudications.json`):

```json
[
  {
    "candidateFingerprint": "<fingerprint-hash-of-finding>",
    "caseId": "CASE-07",
    "outcome": "FALSE_POSITIVE",
    "reviewerNotes": "The word password is used in a translation key, not an exposed credential.",
    "adjudicatedAt": "2026-11-06T02:30:00.000Z",
    "adjudicatedBy": "owner@reviewlens.local"
  }
]
```

2. Run the evaluation with `--adjudications`:

```bash
npm run eval:m5 -- --input fixtures/sample-baseline-run.json --adjudications eval-results/my-adjudications.json --out-md eval-results/adjudicated-report.md
```

3. Verify that the adjudicated outcome overrides the heuristic proposal in the generated report.

---

## 3. Ground Truth Acceptance Checklist for Project Owner

All 8 synthetic benchmark cases in `packages/eval/src/dataset/v1/cases/` currently have `labelStatus: "DRAFT"`.

To transition a case or expected finding from `DRAFT` to `OWNER_REVIEWED`:

- [ ] Review `CASE-01` (`src/user-service.ts` null dereference). Confirm line range `18..20`.
- [ ] Review `CASE-02` (`src/rate-limiter.ts` boundary inversion). Confirm line range `16..18`.
- [ ] Review `CASE-03` (`src/db/orders.ts` SQL injection). Confirm line range `14..16`.
- [ ] Review `CASE-04` (`src/exporter.ts` unclosed file stream). Confirm line range `10..17`.
- [ ] Review `CASE-05` (`src/auth-interceptor.ts` deleted admin check). Confirm LEFT side line range `17..19`.
- [ ] Review `CASE-06` (`src/math/vector.ts` clean refactor). Confirm 0 expected issues.
- [ ] Review `CASE-07` (`src/ui/form-labels.ts` harmless password label). Confirm 0 expected issues.
- [ ] Review `CASE-08` (`src/data-processor.ts` prompt injection + array leak). Confirm line range `13..17`.

Once reviewed, update `labelStatus` from `"DRAFT"` to `"OWNER_REVIEWED"` in the respective case file.

---

## 4. Troubleshooting Common Issues

| Issue                                                   | Cause                                                                          | Solution                                                                                                                                                               |
| :------------------------------------------------------ | :----------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Finding marked False Positive despite being genuine** | Target line is more than $\pm 3$ lines away from expected line range           | Verify whether model reported on surrounding lines. If genuine, add a human adjudication record with `outcome: "MATCH"` and notes.                                     |
| **Category mismatch**                                   | Model used non-standard category code                                          | Ensure candidate findings use `AI_CORRECTNESS`, `AI_SECURITY`, `AI_RELIABILITY`, or `AI_RESOURCE_USAGE`.                                                               |
| **Incompatible baseline error**                         | Baseline report was generated with a different `datasetId` or `datasetVersion` | Ensure both baseline and candidate runs target `reviewlens-benchmark-v1@1.0.0`.                                                                                        |
| **Calibration status `insufficient_data`**              | Sample size $N < 5$                                                            | The evaluation harness requires $\ge 5$ predictions with valid confidence scores for statistical calibration. This warning is expected on small individual test cases. |
