import type { CaseMatchResult } from "../matching/matcher.js";
import type { FindingCategory, FindingSeverity } from "../dataset/schema.js";

export interface CategoryMetricBreakdown {
  readonly category: FindingCategory;
  readonly tp: number;
  readonly fp: number;
  readonly fn: number;
  readonly precision: number | null;
  readonly recall: number | null;
  readonly f1: number | null;
}

export interface SeverityMetricBreakdown {
  readonly severity: FindingSeverity;
  readonly tp: number;
  readonly fn: number;
  readonly recall: number | null;
}

export interface ClassificationMetrics {
  readonly totalCases: number;
  readonly truePositiveCount: number;
  readonly falsePositiveCount: number;
  readonly falseNegativeCount: number;
  readonly duplicateCount: number;
  readonly unadjudicatedCount: number;
  readonly precision: number | null;
  readonly recall: number | null;
  readonly f1: number | null;
  readonly falsePositivesPerCase: number;
  readonly categoryBreakdown: readonly CategoryMetricBreakdown[];
  readonly severityBreakdown: readonly SeverityMetricBreakdown[];
}

export function computeClassificationMetrics(
  caseResults: readonly CaseMatchResult[],
): ClassificationMetrics {
  const totalCases = caseResults.length;

  let tpCount = 0;
  let fpCount = 0;
  let fnCount = 0;
  let duplicateCount = 0;
  let unadjudicatedCount = 0;

  const categoryCounts = new Map<
    FindingCategory,
    { tp: number; fp: number; fn: number }
  >();
  const severityCounts = new Map<FindingSeverity, { tp: number; fn: number }>();

  const ALL_CATEGORIES: FindingCategory[] = [
    "correctness",
    "security",
    "reliability",
    "performance",
    "resource_usage",
  ];

  const ALL_SEVERITIES: FindingSeverity[] = [
    "critical",
    "high",
    "medium",
    "low",
    "info",
  ];

  for (const cat of ALL_CATEGORIES) {
    categoryCounts.set(cat, { tp: 0, fp: 0, fn: 0 });
  }

  for (const sev of ALL_SEVERITIES) {
    severityCounts.set(sev, { tp: 0, fn: 0 });
  }

  for (const res of caseResults) {
    tpCount += res.truePositives.length;
    fpCount += res.falsePositives.length;
    fnCount += res.falseNegatives.length;
    duplicateCount += res.duplicates.length;
    unadjudicatedCount += res.unadjudicated.length;

    // Track Category TP/FP
    for (const tp of res.truePositives) {
      const cat =
        ALL_CATEGORIES.find((c) => tp.finding.code.toLowerCase().includes(c)) ??
        "correctness";
      const current = categoryCounts.get(cat)!;
      current.tp++;

      const sev = (tp.finding.severity ?? "medium") as FindingSeverity;
      if (severityCounts.has(sev)) {
        severityCounts.get(sev)!.tp++;
      }
    }

    for (const fp of res.falsePositives) {
      const cat =
        ALL_CATEGORIES.find((c) => fp.finding.code.toLowerCase().includes(c)) ??
        "correctness";
      const current = categoryCounts.get(cat)!;
      current.fp++;
    }

    // Track Category/Severity FN
    for (const fn of res.falseNegatives) {
      const cat = fn.category;
      if (categoryCounts.has(cat)) {
        categoryCounts.get(cat)!.fn++;
      }
      const sev = fn.severity;
      if (severityCounts.has(sev)) {
        severityCounts.get(sev)!.fn++;
      }
    }
  }

  // Safe zero-denominator calculations
  const precisionDenominator = tpCount + fpCount;
  const precision =
    precisionDenominator > 0 ? tpCount / precisionDenominator : null;

  const recallDenominator = tpCount + fnCount;
  const recall = recallDenominator > 0 ? tpCount / recallDenominator : null;

  let f1: number | null = null;
  if (precision !== null && recall !== null && precision + recall > 0) {
    f1 = (2 * precision * recall) / (precision + recall);
  }

  const falsePositivesPerCase = totalCases > 0 ? fpCount / totalCases : 0;

  // Build category breakdowns
  const categoryBreakdown: CategoryMetricBreakdown[] = ALL_CATEGORIES.map(
    (category) => {
      const counts = categoryCounts.get(category)!;
      const catP =
        counts.tp + counts.fp > 0 ? counts.tp / (counts.tp + counts.fp) : null;
      const catR =
        counts.tp + counts.fn > 0 ? counts.tp / (counts.tp + counts.fn) : null;
      let catF1: number | null = null;
      if (catP !== null && catR !== null && catP + catR > 0) {
        catF1 = (2 * catP * catR) / (catP + catR);
      }
      return {
        category,
        tp: counts.tp,
        fp: counts.fp,
        fn: counts.fn,
        precision: catP,
        recall: catR,
        f1: catF1,
      };
    },
  );

  // Build severity breakdowns
  const severityBreakdown: SeverityMetricBreakdown[] = ALL_SEVERITIES.map(
    (severity) => {
      const counts = severityCounts.get(severity)!;
      const sevR =
        counts.tp + counts.fn > 0 ? counts.tp / (counts.tp + counts.fn) : null;
      return {
        severity,
        tp: counts.tp,
        fn: counts.fn,
        recall: sevR,
      };
    },
  );

  return {
    totalCases,
    truePositiveCount: tpCount,
    falsePositiveCount: fpCount,
    falseNegativeCount: fnCount,
    duplicateCount,
    unadjudicatedCount,
    precision,
    recall,
    f1,
    falsePositivesPerCase,
    categoryBreakdown,
    severityBreakdown,
  };
}
