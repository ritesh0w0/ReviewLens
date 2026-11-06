# ReviewLens M5 — Lightweight Evaluation Framework Architecture & Reference

## 1. Purpose and Philosophy

ReviewLens is an evidence-first AI-assisted GitHub Pull Request review application. As the platform incorporates deterministic rules (M3) and LLM-driven deep analysis (M4), engineering teams must objectively evaluate the quality of candidate findings without relying on anecdotal vibes or uncontrolled live API expenditures.

The M5 Evaluation Framework provides a lightweight, offline, reproducible evaluation framework that measures:

1. **Semantic Finding Quality**: Defect detection, precision, recall, and false-positive resistance.
2. **Localization Accuracy**: Exact anchoring vs near-line drift ($\pm 3$ lines tolerance).
3. **Evidence Validity vs Semantic Correctness**: Clear separation between structural evidence verification (code existence, hunk validation) and semantic correctness (identifying genuine bugs vs false alarms).
4. **Confidence Calibration**: Observational analysis (Brier score, Expected Calibration Error, reliability buckets) guarded by strict statistical sample size checks ($N \ge 5$).
5. **Regression Detection**: Quantified comparison between baseline and candidate models or prompt versions before deploying to production.

All evaluations are **100% offline**, deterministic, and run with a **₹0 API cost** budget.

---

## 2. Package Architecture (`@reviewlens/eval`)

The evaluation harness resides in `packages/eval`, maintaining separation between review engine logic (`packages/core`), backend I/O services (`apps/api`), and web interface (`apps/web`).

```
packages/eval/
├── src/
│   ├── dataset/
│   │   ├── schema.ts                # Zod schemas for EvaluationCase, ExpectedFinding, BenchmarkDataset
│   │   ├── loader.ts                # Dataset validation, loader, and DatasetRegistry
│   │   └── v1/                      # Versioned benchmark dataset v1 (1.0.0)
│   │       ├── cases/               # 8 synthetic PR benchmark cases
│   │       │   ├── case-01-null-dereference.ts
│   │       │   ├── case-02-inverted-boundary.ts
│   │       │   ├── case-03-sql-injection.ts
│   │       │   ├── case-04-resource-leak.ts
│   │       │   ├── case-05-deleted-auth-check.ts
│   │       │   ├── case-06-clean-refactor.ts
│   │       │   ├── case-07-harmless-password-label.ts
│   │       │   └── case-08-prompt-injection.ts
│   │       └── index.ts             # Bundles BENCHMARK_DATASET_V1
│   ├── matching/
│   │   ├── adjudication.ts          # Human adjudication store and outcome schema
│   │   └── matcher.ts               # Heuristic matcher, localization tracking, duplicate inflation prevention
│   ├── metrics/
│   │   ├── classification.ts        # Precision, Recall, F1, FP/Case, category & severity breakdowns
│   │   ├── localization.ts          # Exact location, inexact location, mean and max line offsets
│   │   └── calibration.ts           # Brier score, ECE, 5 reliability bins, N < 5 guard
│   ├── runner/
│   │   ├── input-schema.ts          # Provider-neutral EvaluationRunInputSchema (no prompts/keys)
│   │   ├── result-loader.ts         # JSON file loader and parser
│   │   ├── evaluation-runner.ts     # Orchestrates dataset matching and metric computations
│   │   └── regression.ts            # Compares baseline vs candidate reports, identifies regressions
│   ├── reporting/
│   │   ├── markdown-report.ts       # GitHub Flavored Markdown (GFM) report with reproducibility manifest
│   │   └── json-report.ts           # Machine-readable JSON report
│   ├── cli.ts                       # Command-line interface
│   └── index.ts                     # Public API exports
├── fixtures/
│   ├── sample-baseline-run.json     # Reference baseline run (gemini-3.5-flash-lite)
│   ├── sample-candidate-run.json    # Candidate evaluation run (gemini-3.5-pro)
│   └── sample-adjudications.json    # Sample human adjudication overrides
└── test/                            # 40 automated offline tests across 6 test suites
```

---

## 3. Benchmark Dataset v1 (`reviewlens-benchmark-v1`)

The v1 benchmark dataset contains 8 diverse, realistic synthetic pull requests representing standard code review challenges:

| Case ID   | Title                                      | Purpose                | Files Changed             | Expected Issues               | Target Anchor      |
| :-------- | :----------------------------------------- | :--------------------- | :------------------------ | :---------------------------- | :----------------- |
| `CASE-01` | Optional Chaining Null Dereference         | Correctness            | `src/user-service.ts`     | 1 (`correctness`, `high`)     | Line 18–20 (RIGHT) |
| `CASE-02` | Inverted Rate Limiting Boundary            | Correctness            | `src/rate-limiter.ts`     | 1 (`correctness`, `critical`) | Line 16–18 (RIGHT) |
| `CASE-03` | SQL Concatenation Vulnerability            | Security               | `src/db/orders.ts`        | 1 (`security`, `critical`)    | Line 14–16 (RIGHT) |
| `CASE-04` | Unclosed File Stream & Unhandled Rejection | Reliability            | `src/exporter.ts`         | 1 (`reliability`, `high`)     | Line 10–17 (RIGHT) |
| `CASE-05` | Deleted Admin Authorization Check          | Security (Deletion)    | `src/auth-interceptor.ts` | 1 (`security`, `critical`)    | Line 17–19 (LEFT)  |
| `CASE-06` | Clean Vector Math Refactoring              | False-Positive Test    | `src/math/vector.ts`      | 0 (Clean)                     | None               |
| `CASE-07` | Harmless Password Label UI Constant        | False-Positive Test    | `src/ui/form-labels.ts`   | 0 (Clean)                     | None               |
| `CASE-08` | Prompt Injection Resistance & Memory Leak  | Adversarial & Resource | `src/data-processor.ts`   | 1 (`resource_usage`, `high`)  | Line 13–17 (RIGHT) |

### Draft Ground Truth Status

> [!IMPORTANT]
> In accordance with strict evaluation integrity principles, all expected findings in `BENCHMARK_DATASET_V1` are explicitly stamped with `labelStatus: "DRAFT"`. They remain draft proposals until formally reviewed and accepted by the project owner.

---

## 4. Matching & Adjudication Rules

Evaluation separates semantic correctness from localization accuracy:

### 1. Human Adjudication Precedence

If an evaluation run is paired with an adjudication file, explicit human decisions in `AdjudicationStore` strictly override automated heuristics:

- `MATCH`: Ground-truth defect correctly identified.
- `FALSE_POSITIVE`: Inaccurate, trivial, cosmetic, or hallucinated finding.
- `DUPLICATE`: Redundant finding reporting an issue already detected.
- `NOT_ACTIONABLE`: Finding is technically true but provides no value or actionable fix.
- `NEEDS_REVIEW`: Ambiguous finding awaiting human reviewer triage.

### 2. Automated Heuristic Matching

When unadjudicated, findings are matched against ground-truth issues using strict deterministic criteria:

1. **Target File & Side Match**: Candidate `path` and `side` (LEFT/RIGHT) must match expected issue exactly.
2. **Category Compatibility**: Candidate finding code (e.g., `AI_CORRECTNESS`) must map to the expected defect category (e.g., `correctness`).
3. **Localization Proximity**:
   - **Exact Match** ($offset = 0$): Candidate line is within `[start, end]` of expected issue $\rightarrow$ `outcome: MATCH`, `isLocalizationAccurate: true`, `lineOffset: 0`.
   - **Near Match** ($1 \le offset \le 3$): Candidate line is within $\pm 3$ lines tolerance $\rightarrow$ `outcome: MATCH`, `isLocalizationAccurate: false`, `lineOffset: offset`. Counts as True Positive for issue detection.
   - **Outside Window** ($offset > 3$): Rejected as a match $\rightarrow$ candidate becomes `FALSE_POSITIVE`, expected issue remains `FALSE_NEGATIVE`.
4. **Duplicate Inflation Prevention**: Only the first candidate finding targeting an expected issue earns `MATCH`. Subsequent candidate findings targeting the same expected issue are classified as `DUPLICATE` and never increment True Positives.

---

## 5. Metrics Formulation & Edge Cases

### Classification Metrics

$$\text{Precision} = \frac{TP}{TP + FP}$$
$$\text{Recall} = \frac{TP}{TP + FN}$$
$$F_1 = 2 \cdot \frac{\text{Precision} \cdot \text{Recall}}{\text{Precision} + \text{Recall}}$$
$$\text{False Positives / Case} = \frac{FP}{N_{\text{cases}}}$$

- **Safe Zero Denominators**: If $TP + FP = 0$, Precision returns `null` (not 0, not `NaN`). If $TP + FN = 0$, Recall returns `null`. If $\text{Precision} + \text{Recall} = 0$, $F_1$ returns `null`.
- **Exclusion of Unadjudicated Findings**: Findings marked `NEEDS_REVIEW` are tracked separately and excluded from definitive precision and recall calculations to prevent skewing benchmark scores.

### Localization Metrics

- **Localization Accuracy Rate**: Proportion of True Positives with exact line anchoring ($offset = 0$).
- **Mean & Max Line Offset**: Average and worst-case line distance from expected line anchors.

### Observational Confidence Calibration

- **Brier Score**: Mean squared error between model confidence score $c_i \in [0, 1]$ and binary correctness $y_i \in \{0, 1\}$.
  $$\text{Brier Score} = \frac{1}{N} \sum_{i=1}^N (c_i - y_i)^2$$
- **Expected Calibration Error (ECE)**: Weighted difference between confidence and observed accuracy across 5 equal-width bins: `[0, 0.2)`, `[0.2, 0.4)`, `[0.4, 0.6)`, `[0.6, 0.8)`, `[0.8, 1.0]`.
- **Statistical Insignificance Guard**: When sample size $N < 5$, `status` is set to `"insufficient_data"`, and Brier score and ECE return `null`. Per project rules, confidence is never used to filter or threshold findings.

---

## 6. CLI Usage & Reproducibility

Execute evaluation runs using npm or directly via `tsx`:

```bash
# Run baseline evaluation with default offline deterministic inputs
npm run eval:m5

# Run evaluation on specific run input and output Markdown and JSON reports
npm run eval:m5 -- --input fixtures/sample-baseline-run.json --out-md eval-results/baseline.md --out-json eval-results/baseline.json

# Run candidate evaluation with baseline regression comparison
npm run eval:m5 -- --input fixtures/sample-candidate-run.json --baseline eval-results/baseline.json --out-md eval-results/candidate.md --out-json eval-results/candidate.json

# Run with human adjudication overrides
npm run eval:m5 -- --input fixtures/sample-baseline-run.json --adjudications fixtures/sample-adjudications.json
```

### Reproducibility Manifest

Every generated report contains an immutable cryptographic and environment manifest:

- `runId`: Unique evaluation run identifier.
- `datasetId` & `datasetVersion`: Identifier and semantic version of the benchmark dataset.
- `datasetChecksum`: SHA-256 hash of the complete dataset structure.
- `evaluator`: Identity or system running the evaluation.
- `modelId` & `provider`: Evaluated model and vendor.
- `promptVersion` & `schemaVersion`: Version tags of prompts and finding schemas.
- **Zero Secret Guarantee**: Reports never include raw prompts, source diffs, or API keys.
