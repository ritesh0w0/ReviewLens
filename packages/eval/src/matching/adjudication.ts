import { z } from "zod";

export const AdjudicationOutcomeSchema = z.enum([
  "MATCH",
  "FALSE_POSITIVE",
  "DUPLICATE",
  "NOT_ACTIONABLE",
  "NEEDS_REVIEW",
]);
export type AdjudicationOutcome = z.infer<typeof AdjudicationOutcomeSchema>;

export const AdjudicationRecordSchema = z.object({
  candidateFingerprint: z.string().min(1),
  caseId: z.string().min(1),
  matchedIssueId: z.string().optional(),
  outcome: AdjudicationOutcomeSchema,
  reviewerNotes: z.string().optional(),
  adjudicatedAt: z.string().datetime(),
  adjudicatedBy: z.string().min(1),
});
export type AdjudicationRecord = z.infer<typeof AdjudicationRecordSchema>;

export class AdjudicationStore {
  private readonly records = new Map<string, AdjudicationRecord>();

  constructor(initialRecords: readonly AdjudicationRecord[] = []) {
    for (const record of initialRecords) {
      this.add(record);
    }
  }

  add(record: AdjudicationRecord): void {
    const validated = AdjudicationRecordSchema.parse(record);
    this.records.set(validated.candidateFingerprint, validated);
  }

  get(candidateFingerprint: string): AdjudicationRecord | undefined {
    return this.records.get(candidateFingerprint);
  }

  getAll(): readonly AdjudicationRecord[] {
    return Array.from(this.records.values());
  }

  size(): number {
    return this.records.size;
  }
}
