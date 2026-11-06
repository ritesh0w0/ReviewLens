# ReviewLens

> **Evidence-first, AI-assisted GitHub Pull Request Reviewer designed to eliminate hallucinations through strict diff-grounded verification.**

[![CI/CD Pipeline](https://github.com/ritesh0w0/ReviewLens/actions/workflows/ci.yml/badge.svg)](https://github.com/ritesh0w0/ReviewLens/actions/workflows/ci.yml)
[![Node.js Version](https://img.shields.io/badge/node-24.x-brightgreen.svg)](https://nodejs.org/)
[![TypeScript Strict](https://img.shields.io/badge/typescript-strict%20mode-blue.svg)](https://www.typescriptlang.org/)
[![Database](https://img.shields.io/badge/database-PostgreSQL%2016-blue.svg)](https://www.postgresql.org/)

---

## 1. The Problem

Automated AI code review tools frequently suffer from **hallucinations and ungrounded advice**:

- Recommending fixes for code that does not exist in the PR diff.
- Inventing false-positive syntax or type errors due to prompt truncation.
- Suggesting security alerts on unchanged files outside the pull request scope.
- Overwhelming developers with low-value stylistic noise.

---

## 2. The Solution: Evidence-First Review Architecture

ReviewLens treats all LLM candidate findings as **untrusted suggestions**. Before any finding is published to GitHub:

1. **Deterministic Rules Execute First:** High-confidence static rules (banned patterns, required companions, AST linting) run locally with zero latency.
2. **Multi-Model Semantic Analysis:** Semantic defects are analyzed across a fallback cascade of LLMs (`gemini-3.5-flash-lite` → `gemini-3.6-flash` → `openai/gpt-oss-120b` via Groq).
3. **The Evidence Validation Gate:** Every model finding is validated by pure core logic against the unified diff. If the reported line number or code snippet cannot be proven to exist in the added lines (`+` hunks) of the pull request, the finding is **summarily discarded**.
4. **Advisory Inline Comments:** Validated findings are prioritized, deduplicated, and published as structured GitHub review comments.

---

## 3. System Architecture

```mermaid
flowchart TD
    subgraph GitHub ["GitHub Infrastructure"]
        GH_PR["Pull Request Event"]
        GH_APP["GitHub App"]
        GH_OAUTH["OAuth PKCE S256"]
    end

    subgraph Host ["Azure Production VM (Nginx Gateway)"]
        NGINX["Nginx Gateway (:443 SSL)"]
        NG_RL_WEB["/reviewlens/ -> Web (:3000)"]
        NG_RL_API["/reviewlens/api/ -> API (:3001)"]
    end

    subgraph Stack ["ReviewLens Docker Compose Stack"]
        WEB["reviewlens-web (React 19 / Vite 8)"]
        API["reviewlens-api (Express 5 / Node 24)"]
        WORKER["reviewlens-worker (Review Pipeline)"]
        DB[("PostgreSQL 16 (pg-boss Queue)")]
    end

    subgraph AI ["AI Provider Cascade"]
        GEMINI["Gemini 3.5 Flash-Lite / 3.6 Flash"]
        GROQ["Groq (openai/gpt-oss-120b)"]
    end

    GH_PR -->|Webhook POST| NGINX
    NGINX -->|/reviewlens/| NG_RL_WEB --> WEB
    NGINX -->|/reviewlens/api/| NG_RL_API --> API

    API -->|1. HMAC Verify & Persist| DB
    API -->|2. Enqueue Job| DB
    DB -.->|Claim Job| WORKER

    WORKER -->|3. Fetch PR Diff| GH_APP
    WORKER -->|4. Deterministic Rules| WORKER
    WORKER -->|5. Semantic Analysis| AI
    WORKER -->|6. Evidence Validation Gate| WORKER
    WORKER -->|7. Deduplicate & Rank| WORKER
    WORKER -->|8. Post Advisory Review| GH_APP

    WEB -->|Query Telemetry| API
    GH_OAUTH <-->|Authorize / Callback| API
```

---

## 4. Key Capabilities

- **Zero-Hallucination Evidence Gate:** Verifies exact line and snippet match in diff additions before publication.
- **Multi-Provider Fallback Cascade:** Resilient cascade from Gemini 3.5 Flash-Lite to Gemini 3.6 Flash and Groq GPT-OSS-120B with automatic 429/503 rate-limit failover.
- **Durable Asynchronous Pipeline:** pg-boss handles distributed job queues with retry limits, exponential backoff, and idempotent delivery tracking.
- **Hardened Authentication:** GitHub OAuth 2.0 with PKCE S256, AES-256-GCM token encryption at rest, SHA-256 hashed session storage, and double-submit CSRF cookies.
- **Comprehensive Evaluation Benchmark:** Evaluated against 8 synthetic pull request test cases with independent precision, recall, and F1 scoring.
- **Isolated Multi-Tenant Coexistence:** Operates safely alongside other production workloads (APIDash and TrackFlow) using Docker Compose and Nginx subpath routing.

---

## 5. Technology Stack

- **Runtime & Language:** Node.js 24, TypeScript strict mode (zero unannotated `any`).
- **Backend API:** Express 5, Pino logger, Zod 4 input validation.
- **Database & ORM:** PostgreSQL 16, Prisma 7, pg-boss job queue.
- **AI Integrations:** `@google/genai` (Gemini API), `groq-sdk` (Groq API).
- **GitHub Integration:** `@octokit/rest`, `@octokit/auth-app`.
- **Frontend Dashboard:** React 19, Vite 8, Tailwind CSS 4, TanStack Query 5, Lucide icons.
- **Testing & Quality:** Vitest, Supertest, ESLint, Oxlint, Prettier.
- **Containerization & CI/CD:** Docker, Docker Compose, GitHub Actions, GitHub Container Registry (GHCR).

---

## 6. Monorepo Repository Structure

```text
reviewlens/
├── .github/
│   └── workflows/
│       └── ci.yml               # Complete CI/CD and deployment pipeline
├── apps/
│   ├── api/                     # Express 5 API, GitHub App, pg-boss worker
│   │   ├── src/
│   │   │   ├── ai/              # Multi-model LLM provider cascade
│   │   │   ├── auth/            # PKCE, AES-256-GCM encryption, sessions
│   │   │   ├── db/              # Prisma client and query helpers
│   │   │   ├── github/          # Webhook verification, Octokit clients
│   │   │   ├── queue/           # pg-boss queue setup and lifecycle
│   │   │   ├── routes/          # REST API endpoints
│   │   │   └── workers/         # Review processor background orchestrator
│   └── web/                     # React 19 SPA dashboard
│       └── src/                 # Pages, components, hooks, Tailwind 4 UI
├── packages/
│   ├── core/                    # Pure deterministic review engine (zero-I/O)
│   │   └── src/
│   │       ├── diff/            # Unified diff parser and hunk indexer
│   │       ├── review/          # Evidence validator, ranking, rules
│   │       └── types/           # Canonical domain types
│   └── eval/                    # Evaluation suite & benchmark runner
├── prisma/
│   ├── schema.prisma            # Prisma schema (PostgreSQL)
│   └── migrations/              # Versioned SQL migrations
├── scripts/
│   ├── deploy.sh                # Restricted production deployment wrapper
│   └── ops-check.sh             # Production operations & health check
├── docs/                        # Architecture, CI/CD, and runbooks
├── Dockerfile                   # Multi-stage server image
├── Dockerfile.web               # Multi-stage web Nginx image
└── docker-compose.yml           # Development Docker Compose
```

---

## 7. Local Development Setup

### Prerequisites

- Node.js 24+
- Docker Desktop
- Git

### Installation

```bash
# 1. Clone repository
git clone https://github.com/ritesh0w0/ReviewLens.git
cd ReviewLens

# 2. Install workspace dependencies
npm ci

# 3. Configure local environment variables
cp .env.example .env

# 4. Start local development PostgreSQL container
docker compose up -d reviewlens-db

# 5. Run Prisma migrations and generate client
npm run prisma:generate
npx prisma migrate dev

# 6. Start API server and Web dashboard concurrently
npm run dev
```

The API will listen at `http://localhost:3001` and the React dashboard at `http://localhost:5173`.

---

## 8. Environment Variable Reference

| Variable Name                  | Required By       | Description                                                   |
| :----------------------------- | :---------------- | :------------------------------------------------------------ |
| `NODE_ENV`                     | API / Worker      | Environment mode (`development`, `production`, `test`).       |
| `PORT`                         | API               | HTTP port for Express API (default: `3001`).                  |
| `DATABASE_URL`                 | API / Worker      | PostgreSQL connection string for Prisma & pg-boss.            |
| `DIRECT_DATABASE_URL`          | Migrator          | Direct PostgreSQL connection string for migrations.           |
| `DATABASE_URL_TEST`            | Integration Tests | Dedicated PostgreSQL test database URL.                       |
| `GITHUB_APP_ID`                | API / Worker      | Numeric GitHub App ID.                                        |
| `GITHUB_PRIVATE_KEY` / `_FILE` | API / Worker      | RSA Private Key PEM or path to key file.                      |
| `GITHUB_WEBHOOK_SECRET`        | API               | Secret string configured in GitHub App webhook settings.      |
| `GITHUB_CLIENT_ID`             | API               | GitHub App OAuth Client ID.                                   |
| `GITHUB_CLIENT_SECRET`         | API               | GitHub App OAuth Client Secret.                               |
| `GITHUB_OAUTH_CALLBACK_URL`    | API               | OAuth callback URL.                                           |
| `SESSION_ENCRYPTION_KEY`       | API               | 32-byte hex key for AES-256-GCM token encryption.             |
| `COOKIE_PATH`                  | API               | Path scope for session and CSRF cookies (e.g. `/reviewlens`). |
| `FRONTEND_URL`                 | API               | Public dashboard landing URL.                                 |
| `GEMINI_API_KEY`               | Worker            | Google Gemini API key.                                        |
| `GROQ_API_KEY`                 | Worker            | Groq API key for OSS model fallback.                          |
| `REVIEWLENS_AI_ENABLED`        | Worker            | Master feature flag for AI analysis (`true`/`false`).         |
| `REVIEWLENS_AI_PROFILE`        | Worker            | Provider profile (`production`, `development`).               |

---

## 9. Testing & Quality Verification

Run the complete monorepo test suites:

```bash
# Run unit and evaluation test suites (331 tests)
npm test

# Run PostgreSQL integration tests (37 tests across 9 suites)
npm run test:integration

# Run strict TypeScript typecheck
npm run typecheck

# Run linters (ESLint + Oxlint)
npm run lint

# Check code formatting
npm run format:check

# Build all monorepo packages
npm run build
```

---

## 10. Production Deployment & Operations

ReviewLens is deployed on Azure VM at `apidash-7f29a6.centralindia.cloudapp.azure.com`:

- **Dashboard:** `https://apidash-7f29a6.centralindia.cloudapp.azure.com/reviewlens/`
- **API Health:** `https://apidash-7f29a6.centralindia.cloudapp.azure.com/reviewlens/api/healthz`
- **API Readiness:** `https://apidash-7f29a6.centralindia.cloudapp.azure.com/reviewlens/api/readyz`

For operational procedures and incident response:

- [Production Deployment Guide](docs/deployment/production.md)
- [CI/CD Pipeline Guide](docs/deployment/ci-cd.md)
- [Operations Runbook](docs/operations/runbook.md)
- [Incident Response Guide](docs/operations/incident-recovery.md)
- [Security Model](docs/security/security-model.md)

---

## 11. Known Limitations & Roadmap

### Current Limitations

- **Diff Size Cap:** Maximum PR diff size is capped at 500 KB to prevent LLM context exhaustion.
- **Advisory Only:** Review comments are advisory (`COMMENT` events); approval/blocking reviews are intentionally not enforced.
- **Database Backup:** By design decision, automated database backups are not enabled on the shared VM.

### Roadmap

- [ ] Add semantic embedding search across repository historical PR reviews.
- [ ] Implement team-customizable rule configurations via `.reviewlens.yml` in repository roots.
- [ ] Support multi-turn review discussions with inline author replies.
