# ReviewLens

Evidence-first, AI-assisted GitHub Pull Request code-review platform.

ReviewLens combines deterministic repository-owned code review rules with semantic LLM analysis and cryptographic evidence validation. It operates as an advisory GitHub App: it publishes targeted line-level review comments, never approves PRs or requests changes, never blocks merging, and never modifies repository code.

## Architecture

ReviewLens is architected as a modular TypeScript monolith with separate API and worker processes:

- **Runtime**: Node.js >= 24 (Debian Bookworm)
- **Language**: Strict TypeScript with ES modules
- **Backend API**: Express 5
- **Persistence**: PostgreSQL 16 managed via Prisma ORM
- **Security**: Webhook HMAC-SHA256 signature verification over raw request buffers, two-tier idempotency, timing-safe equality checks
- **Testing**: Vitest, Supertest, isolated mock tests, and real PostgreSQL integration test harness
- **Containers**: Docker and Docker Compose

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 24
- [Docker](https://www.docker.com/) and Docker Compose v2+
- npm workspaces (shipped with Node.js)

### 1. Environment Configuration

Copy the example environment configuration:

```bash
cp .env.example .env
```

Ensure `.env` contains:

```env
PORT=3001
NODE_ENV=development
GITHUB_WEBHOOK_SECRET=development-only-webhook-secret
DATABASE_URL="postgresql://reviewlens:reviewlens_dev_password@127.0.0.1:55432/reviewlens_dev?schema=public"
DIRECT_DATABASE_URL="postgresql://reviewlens:reviewlens_dev_password@127.0.0.1:55432/reviewlens_dev?schema=public"
DATABASE_URL_TEST="postgresql://reviewlens:reviewlens_dev_password@127.0.0.1:55432/reviewlens_test?schema=public"
DIRECT_DATABASE_URL_TEST="postgresql://reviewlens:reviewlens_dev_password@127.0.0.1:55432/reviewlens_test?schema=public"
```

### 2. Install Dependencies

```bash
npm ci
```

### 3. Start Local PostgreSQL Database

Start the dedicated PostgreSQL 16 container (`reviewlens-db`):

```bash
docker compose up -d db
```

This starts PostgreSQL on `127.0.0.1:55432` and automatically initializes two isolated databases:

- `reviewlens_dev` (development)
- `reviewlens_test` (integration testing)

### 4. Run Database Migrations

Apply Prisma migrations to the development and test databases:

```bash
# Development database
npx prisma migrate deploy

# Test database
DATABASE_URL="postgresql://reviewlens:reviewlens_dev_password@127.0.0.1:55432/reviewlens_test?schema=public" npx prisma migrate deploy
```

### 5. Run the Local Backend API

Run the API in watch mode:

```bash
npm run dev --workspace=@reviewlens/api
```

Check health and database readiness:

```bash
curl http://localhost:3001/healthz
curl http://localhost:3001/readyz
```

---

## Running with Full Docker Compose

To start both the database and the backend container simultaneously:

```bash
docker compose up -d
```

Verify service status and healthchecks:

```bash
docker compose ps
```

---

## Testing & Quality Verification

ReviewLens separates fast in-memory mock tests from live database integration tests:

### Unit & Mock Tests (Fast)

Does not require a live database. Tests signature verification, schema parsing, and business logic with in-memory Prisma mocks:

```bash
npm test
```

### PostgreSQL Integration Tests

Requires the local `reviewlens-db` container. Enforces safety guards to prevent accidental execution against production databases:

```bash
# Ensure DATABASE_URL_TEST is set to reviewlens_test on approved port 55432 or 5432
npm run test:integration
```

Verified integration suites:

1. `schema-and-migration.integration.test.ts` — Table schema, enum types, and `_prisma_migrations` audit.
2. `constraints-and-foreign-keys.integration.test.ts` — Primary key, composite unique, `onDelete: Restrict`, and `onDelete: SetNull` constraints.
3. `transactions-and-data-types.integration.test.ts` — Multi-operation transaction rollback and data fidelity (`BigInt`, `UUID`, `Decimal(12, 8)`, `TIMESTAMPTZ(3)`).
4. `webhook-persistence.integration.test.ts` — End-to-end webhook persistence, signature enforcement, duplicate replays, and stranded delivery recovery.
5. `real-concurrency.integration.test.ts` — High-concurrency race condition testing across identical deliveries and concurrent revisions.

### Static Analysis & Linting

```bash
npm run typecheck    # Strict TypeScript checks across all workspaces
npm run lint         # ESLint / Oxlint rules
npm run format:check # Prettier formatting verification
npm run build        # Monorepo production build
```

---

## Container Build

Build the production backend image (`reviewlens-backend:m0`):

```bash
docker build -t reviewlens-backend:m0 .
```

The Docker image uses a multi-stage build on `node:24-bookworm-slim`, drops privileges to non-root user `node`, and includes only production dependencies.
