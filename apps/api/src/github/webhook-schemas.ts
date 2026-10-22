import { z } from "zod";

export const genericWebhookPayloadSchema = z.record(z.string(), z.unknown());

export const githubPullRequestPayloadSchema = z.object({
  action: z.string(),
  number: z.number().int(),
  pull_request: z.object({
    number: z.number().int(),
    draft: z.boolean().optional(),
    head: z.object({
      sha: z.string().min(1),
      ref: z.string().optional(),
    }),
    base: z.object({
      sha: z.string().min(1),
      ref: z.string().optional(),
    }),
    user: z
      .object({
        login: z.string().optional(),
        type: z.string().optional(),
      })
      .optional(),
  }),
  repository: z.object({
    id: z.number().int(),
    full_name: z.string().min(1),
    default_branch: z.string().optional(),
    owner: z
      .object({
        login: z.string().optional(),
      })
      .optional(),
  }),
  installation: z
    .object({
      id: z.number().int(),
      account: z
        .object({
          login: z.string().optional(),
          type: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

export type GitHubPullRequestPayload = z.infer<
  typeof githubPullRequestPayloadSchema
>;

export const SUPPORTED_PULL_REQUEST_ACTIONS = [
  "opened",
  "reopened",
  "synchronize",
  "ready_for_review",
] as const;

export type SupportedPullRequestAction =
  (typeof SUPPORTED_PULL_REQUEST_ACTIONS)[number];

export function isSupportedPullRequestAction(
  action: string,
): action is SupportedPullRequestAction {
  return (SUPPORTED_PULL_REQUEST_ACTIONS as readonly string[]).includes(action);
}
