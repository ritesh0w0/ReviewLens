-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "github_user_id" BIGINT NOT NULL,
    "github_login" TEXT NOT NULL,
    "avatar_url" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "last_login_at" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "encrypted_github_access_token" TEXT NOT NULL,
    "github_token_expires_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_transactions" (
    "id" UUID NOT NULL,
    "state" TEXT NOT NULL,
    "code_verifier" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_installation_grants" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "installation_github_id" BIGINT NOT NULL,
    "account_login" TEXT NOT NULL,
    "account_type" TEXT NOT NULL,
    "account_avatar_url" TEXT,
    "refreshed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_installation_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_repository_grants" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "installation_github_id" BIGINT NOT NULL,
    "repository_github_id" BIGINT NOT NULL,
    "owner" TEXT NOT NULL,
    "repo_name" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "permissions" JSONB,
    "refreshed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_repository_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_findings" (
    "id" UUID NOT NULL,
    "review_run_id" UUID NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "provenance" TEXT NOT NULL,
    "rule_id" TEXT,
    "model_id" TEXT,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "confidence" DECIMAL(4,3),
    "file_path" TEXT,
    "line" INTEGER,
    "side" TEXT,
    "scope" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_findings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_github_user_id_key" ON "users"("github_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_token_hash_idx" ON "sessions"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_transactions_state_key" ON "oauth_transactions"("state");

-- CreateIndex
CREATE INDEX "oauth_transactions_state_idx" ON "oauth_transactions"("state");

-- CreateIndex
CREATE INDEX "user_installation_grants_user_id_expires_at_idx" ON "user_installation_grants"("user_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_installation_grants_user_id_installation_github_id_key" ON "user_installation_grants"("user_id", "installation_github_id");

-- CreateIndex
CREATE INDEX "user_repository_grants_user_id_installation_github_id_idx" ON "user_repository_grants"("user_id", "installation_github_id");

-- CreateIndex
CREATE INDEX "user_repository_grants_user_id_expires_at_idx" ON "user_repository_grants"("user_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_repository_grants_user_id_repository_github_id_key" ON "user_repository_grants"("user_id", "repository_github_id");

-- CreateIndex
CREATE INDEX "review_findings_review_run_id_idx" ON "review_findings"("review_run_id");

-- CreateIndex
CREATE INDEX "review_findings_review_run_id_severity_idx" ON "review_findings"("review_run_id", "severity");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_installation_grants" ADD CONSTRAINT "user_installation_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_repository_grants" ADD CONSTRAINT "user_repository_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_findings" ADD CONSTRAINT "review_findings_review_run_id_fkey" FOREIGN KEY ("review_run_id") REFERENCES "review_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

