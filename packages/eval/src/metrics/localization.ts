import type { CaseMatchResult } from "../matching/matcher.js";

export interface LocalizationMetrics {
  readonly totalTruePositives: number;
  readonly exactLocationCount: number;
  readonly inexactLocationCount: number;
  readonly localizationAccuracyRate: number | null;
  readonly meanLineOffset: number;
  readonly maxLineOffset: number;
}

export function computeLocalizationMetrics(
  caseResults: readonly CaseMatchResult[],
): LocalizationMetrics {
  const allTruePositives = caseResults.flatMap((r) => r.truePositives);
  const totalTruePositives = allTruePositives.length;

  if (totalTruePositives === 0) {
    return {
      totalTruePositives: 0,
      exactLocationCount: 0,
      inexactLocationCount: 0,
      localizationAccuracyRate: null,
      meanLineOffset: 0,
      maxLineOffset: 0,
    };
  }

  let exactLocationCount = 0;
  let inexactLocationCount = 0;
  let totalLineOffset = 0;
  let maxLineOffset = 0;

  for (const tp of allTruePositives) {
    if (tp.isLocalizationAccurate) {
      exactLocationCount++;
    } else {
      inexactLocationCount++;
    }

    totalLineOffset += tp.lineOffset;
    if (tp.lineOffset > maxLineOffset) {
      maxLineOffset = tp.lineOffset;
    }
  }

  const localizationAccuracyRate = exactLocationCount / totalTruePositives;
  const meanLineOffset = totalLineOffset / totalTruePositives;

  return {
    totalTruePositives,
    exactLocationCount,
    inexactLocationCount,
    localizationAccuracyRate,
    meanLineOffset,
    maxLineOffset,
  };
}
