-- CreateEnum
CREATE TYPE "ai_execution_status" AS ENUM ('NOT_ENABLED', 'NOT_ELIGIBLE', 'NOT_NEEDED', 'RUNNING', 'COMPLETE', 'PARTIAL', 'UNAVAILABLE', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "ai_review_executions" (
    "id" UUID NOT NULL,
    "review_run_id" UUID NOT NULL,
    "status" "ai_execution_status" NOT NULL DEFAULT 'RUNNING',
    "profile" TEXT NOT NULL,
    "primary_model" TEXT NOT NULL,
    "final_model" TEXT,
    "total_chunks" INTEGER NOT NULL DEFAULT 0,
    "completed_chunks" INTEGER NOT NULL DEFAULT 0,
    "failed_chunks" INTEGER NOT NULL DEFAULT 0,
    "skipped_chunks" INTEGER NOT NULL DEFAULT 0,
    "total_input_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_output_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_candidates_generated" INTEGER NOT NULL DEFAULT 0,
    "total_candidates_validated" INTEGER NOT NULL DEFAULT 0,
    "failure_reason" TEXT,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "ai_review_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_review_chunks" (
    "id" UUID NOT NULL,
    "execution_id" UUID NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "file_paths" TEXT[],
    "model_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "ai_review_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_inference_attempts" (
    "id" UUID NOT NULL,
    "chunk_id" UUID NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "model_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "latency_ms" INTEGER NOT NULL DEFAULT 0,
    "error_category" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_inference_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_review_executions_review_run_id_key" ON "ai_review_executions"("review_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_review_chunks_execution_id_chunk_index_key" ON "ai_review_chunks"("execution_id", "chunk_index");

-- CreateIndex
CREATE INDEX "ai_inference_attempts_chunk_id_attempt_number_idx" ON "ai_inference_attempts"("chunk_id", "attempt_number");

-- AddForeignKey
ALTER TABLE "ai_review_executions" ADD CONSTRAINT "ai_review_executions_review_run_id_fkey" FOREIGN KEY ("review_run_id") REFERENCES "review_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_review_chunks" ADD CONSTRAINT "ai_review_chunks_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "ai_review_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_inference_attempts" ADD CONSTRAINT "ai_inference_attempts_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "ai_review_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

