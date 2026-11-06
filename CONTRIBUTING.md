# Contributing to ReviewLens

Thank you for your interest in contributing to ReviewLens!

---

## 1. Monorepo Structure

- `packages/core`: Pure, deterministic review engine (zero network/database I/O).
- `packages/eval`: Evaluation datasets, benchmarking metrics, and scoring.
- `apps/api`: Express 5 REST API, GitHub App integration, pg-boss worker, and AI provider connectors.
- `apps/web`: React 19 dashboard, Vite 8, Tailwind CSS 4, and TanStack Query 5.

---

## 2. Development Setup

### Prerequisites

- Node.js 24+
- Docker & Docker Compose
- PostgreSQL 16 (or local docker container)

### Quick Start

```bash
# Install dependencies
npm ci

# Set up local environment variables
cp .env.example .env

# Start development database
docker compose up -d

# Run Prisma migrations
npm run prisma:generate
npx prisma migrate dev

# Run all test suites
npm test
npm run test:integration
```

---

## 3. Code Standards & Quality Gates

Every pull request must pass the automated CI pipeline:

1. **Strict TypeScript:** `npm run typecheck` (zero `any` without documented reason).
2. **Linting:** `npm run lint` (ESLint and Oxlint clean).
3. **Unit Tests:** `npm test` (all tests passing).
4. **Integration Tests:** `npm run test:integration` (PostgreSQL 16 clean).
5. **Formatting:** `npm run format:check` (Prettier formatting enforced).
6. **Pure Core:** Do not import `fs`, `fetch`, database clients, or environment variables in `packages/core`.

---

## 4. Commits and Pull Requests

- Use conventional commits (e.g. `feat:`, `fix:`, `docs:`, `test:`, `refactor:`).
- Keep changes focused and reviewable.
- Do not commit secrets, private keys, or `.env` files.
