-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "installation_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "delivery_status" AS ENUM ('RECEIVED', 'ENQUEUED', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "review_status" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'DEGRADED', 'FAILED', 'SUPERSEDED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "review_trigger" AS ENUM ('WEBHOOK', 'MANUAL', 'SWEEPER');

-- CreateTable
CREATE TABLE "installations" (
    "id" UUID NOT NULL,
    "github_installation_id" BIGINT NOT NULL,
    "account_login" TEXT NOT NULL,
    "account_type" TEXT NOT NULL,
    "status" "installation_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "installations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repositories" (
    "id" UUID NOT NULL,
    "installation_id" UUID NOT NULL,
    "github_repo_id" BIGINT NOT NULL,
    "full_name" TEXT NOT NULL,
    "default_branch" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "delivery_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "action" TEXT,
    "installation_github_id" BIGINT,
    "status" "delivery_status" NOT NULL,
    "error" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMPTZ(3),
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "review_run_id" UUID,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("delivery_id")
);

-- CreateTable
CREATE TABLE "review_runs" (
    "id" UUID NOT NULL,
    "repository_id" UUID NOT NULL,
    "pr_number" INTEGER NOT NULL,
    "head_sha" TEXT NOT NULL,
    "base_sha" TEXT NOT NULL,
    "status" "review_status" NOT NULL DEFAULT 'QUEUED',
    "degraded_reason" TEXT,
    "failure_reason" TEXT,
    "trigger" "review_trigger" NOT NULL DEFAULT 'WEBHOOK',
    "config_hash" TEXT,
    "files_total" INTEGER,
    "files_reviewed" INTEGER,
    "candidate_count" INTEGER,
    "posted_count" INTEGER,
    "tokens_in" INTEGER,
    "tokens_out" INTEGER,
    "est_cost_usd" DECIMAL(12,8),
    "github_review_id" BIGINT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "review_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "installations_github_installation_id_key" ON "installations"("github_installation_id");

-- CreateIndex
CREATE UNIQUE INDEX "repositories_github_repo_id_key" ON "repositories"("github_repo_id");

-- CreateIndex
CREATE INDEX "repositories_installation_id_idx" ON "repositories"("installation_id");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_received_at_idx" ON "webhook_deliveries"("status", "received_at");

-- CreateIndex
CREATE INDEX "webhook_deliveries_review_run_id_idx" ON "webhook_deliveries"("review_run_id");

-- CreateIndex
CREATE INDEX "review_runs_repository_id_created_at_idx" ON "review_runs"("repository_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "review_runs_repository_id_pr_number_head_sha_base_sha_key" ON "review_runs"("repository_id", "pr_number", "head_sha", "base_sha");

-- AddForeignKey
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "installations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_review_run_id_fkey" FOREIGN KEY ("review_run_id") REFERENCES "review_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_runs" ADD CONSTRAINT "review_runs_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
