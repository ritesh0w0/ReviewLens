import { z } from "zod";

export const reviewJobPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().uuid(),
});

export type ReviewJobPayload = z.infer<typeof reviewJobPayloadSchema>;
