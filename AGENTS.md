# ReviewLens — Development and AI Agent Rules

## Source of truth

- Read docs/spec.md and docs/decisions/ before changing code.
- The specification defines scope and acceptance criteria.
- If code conflicts with the specification, explain the conflict before changing either.

## Scope

- Work on one milestone task at a time.
- Do not silently add features, services, dependencies, or scope.
- Prefer small, reviewable changes over large rewrites.

## Engineering

- Use strict TypeScript.
- Avoid `any`; when unavoidable, explain why in a comment.
- Validate untrusted inputs with Zod at system boundaries.
- Keep pure review logic in packages/core.
- Keep network, database, filesystem and other I/O in apps.
- Add tests for changes, including negative/error cases.

## Security

- Verify GitHub webhook signatures before parsing webhook JSON.
- Never log secrets, tokens, prompts or diffs.
- Never trust an ID supplied by the browser without authorization checks.
- Treat model output as untrusted.
- Do not post findings that fail the required validation checks.
- Never commit credentials or private keys.

## AI and dependencies

- Put the LLM provider behind a provider-neutral interface.
- Keep tests deterministic; tests must not require a live model API.
- Justify every new dependency: why it is needed, alternatives,
  chosen version, and maintenance status.
- Inspect actual installed versions and official documentation.
  Do not invent APIs or configuration fields.

## Verification and handoff

- Never claim a feature works without running relevant checks.
- Report the actual commands and results.
- Clearly identify anything not verified, known risks and follow-up work.
- Update the relevant documentation when implementation decisions change.
- Explain the code and design choices so the developer can defend them.
