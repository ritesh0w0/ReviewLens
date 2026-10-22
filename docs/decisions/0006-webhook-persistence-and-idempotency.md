# D-006 — Webhook Persistence and Two-Tier Idempotency

Status: Accepted

Decision:

Implement database persistence using Prisma (PostgreSQL) with two levels of idempotency:

1. Delivery-level idempotency enforced by primary key `webhook_deliveries.delivery_id`.
2. Review-run idempotency enforced by compound unique constraint `(repository_id, pr_number, head_sha, base_sha)` on `review_runs`.

Deliveries are recorded in `webhook_deliveries` with state `RECEIVED` (or `IGNORED`), while jobs will be enqueued in the subsequent background queue integration. Unsupported events, unsupported PR actions, draft PRs, and bot authors are recorded as `IGNORED` with reason strings. Concurrent race conditions on unique constraints are handled safely via Prisma error code `P2002` returning HTTP 200 without creating duplicates or failing requests.

### Schema Design & Architecture Revisions

1. **Review Identity & Uniqueness**:
   - The unique constraint on `review_runs` is `(repository_id, pr_number, head_sha, base_sha)`.
   - `base_sha` is required because a valid review run must represent the exact PR state against which it was reviewed. The same head commit compared against a different base branch represents a different effective diff and distinct review input.
   - Two delivery IDs for the exact same repository, PR, head SHA, and base SHA resolve to one logical review run. A different head or base SHA permits a distinct run.
   - For this MVP, retries reuse the existing logical review record. A forced, separately recorded rerun of a successfully completed identical revision is not yet supported.

2. **Removal of Redundant Foreign Key (`installation_id` on `review_runs`)**:
   - A review run belongs to a repository, and that repository belongs to an installation.
   - Installation ownership is derived cleanly through the `Repository` relationship rather than storing the same relationship twice.

3. **Prisma Enums**:
   - Replace free-form status strings with typed Prisma enums:
     - `InstallationStatus`: `ACTIVE`, `SUSPENDED`, `DELETED`
     - `DeliveryStatus`: `RECEIVED`, `ENQUEUED`, `IGNORED`, `FAILED`
     - `ReviewStatus`: `QUEUED`, `RUNNING`, `SUCCEEDED`, `DEGRADED`, `FAILED`, `SUPERSEDED`, `SKIPPED`
     - `ReviewTrigger`: `WEBHOOK`, `MANUAL`, `SWEEPER`

4. **Non-Cascading Deletion Behavior**:
   - Use `onDelete: Restrict` for `Installation -> Repository` and `Repository -> ReviewRun`.
   - Normal GitHub App uninstall/deletion events deactivate records (soft delete via status enum) rather than destroy review history.

5. **Webhook Delivery Retry and Recovery Metadata**:
   - Added `attempt_count` (default 0), `last_attempt_at` (optional timestamptz), and `updated_at`.
   - Added optional `review_run_id` with `onDelete: SetNull` allowing multiple deliveries to correlate with one logical review run without losing delivery history if a run is purged.
   - Indexed `(status, received_at)` to support queue recovery queries for old incomplete deliveries.

6. **Timestamps & Precision**:
   - All application timestamps use PostgreSQL timezone-aware timestamps (`TIMESTAMPTZ(3)`).
   - Cost estimates use `DECIMAL(12, 8)` to represent small USD model costs accurately.

### Follow-up Requirements for Persistence / Queue Phase

1. **Delivery Recovery**: A delivery recorded as `RECEIVED` but not `ENQUEUED` must be recoverable by a periodic recovery sweeper.
2. **Duplicate Work Prevention**: Already-enqueued deliveries must not generate duplicate logical review work.
3. **Idempotent Queue & Worker Execution**: Queue submissions and worker executions must be idempotent, using a stable run-based key and appropriate worker state checks.
4. **Queue Transaction Limits**: The database schema itself does not provide an atomic distributed transaction across independent queue calls; worker transitions must be resilient.
5. **Worker Verification Pre-Publish**: The worker must verify both the relevant current PR state (head SHA and base SHA) and its run status before publishing review comments to GitHub.

Reason:

GitHub webhooks can be delivered repeatedly, out-of-order, or concurrently. Two-tier idempotency guarantees that duplicate deliveries do not produce duplicate logical review runs or side effects, while new commits (new head SHAs) or rebased targets (new base SHAs) reliably trigger distinct review runs without duplicating data or corrupting historical reviews.

Alternatives Considered:

- In-memory deduplication cache (fails across server restarts or multi-instance deployments).
- Application-level check-then-insert without database constraints (vulnerable to concurrent race conditions).
- Retaining `(repository_id, pr_number, head_sha)` without `base_sha` (fails to review when PR base branch is updated or rebased against main).
- Duplicating `installation_id` on `review_runs` (violates normalization and risks data inconsistency).
