-- AlterTable
ALTER TABLE "review_runs" ADD COLUMN     "attempt_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "claim_token" UUID,
ADD COLUMN     "last_attempt_at" TIMESTAMPTZ(3);
