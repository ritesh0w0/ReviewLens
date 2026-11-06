# ReviewLens Milestone M6: Dashboard and Authorization

## 1. Overview & Objectives

Milestone M6 delivers the human-facing operational dashboard and user authorization tier for ReviewLens. Prior to M6, ReviewLens operated entirely as an automated GitHub App posting advisory reviews directly to GitHub Pull Requests. M6 introduces:

1. **User Authentication & Authorization**: Human sign-in via GitHub OAuth using Authorization Code flow with PKCE (S256), encrypted token storage at rest, and strict per-user repository isolation.
2. **Access Control & Grant Caching**: Explicit repository-level authorization checks backed by short-lived grant caches (5-minute TTL) queried directly from GitHub API.
3. **Operational Dashboard**: A responsive, fast web interface (React 19, Vite, Tailwind CSS v4, TanStack Query v5) presenting high-level review health, repository lists, and review histories.
4. **Deep Review Inspection & AI Transparency**: Detailed per-PR views displaying execution timings, unified diff coverage, deterministic vs AI findings with line coordinates, and granular AI execution telemetry (chunks, attempts, token usage, latency, and model fallbacks).

---

## 2. Security & Identity Architecture

ReviewLens strictly separates the automated backend execution identity from human dashboard users:

| Dimension          | Background Worker / Webhooks              | Human Dashboard User                          |
| :----------------- | :---------------------------------------- | :-------------------------------------------- |
| **Identity Type**  | GitHub App Installation                   | GitHub User (OAuth)                           |
| **Authentication** | RS256 JWT $\to$ Installation Access Token | Authorization Code with PKCE (RFC 7636, S256) |
| **Permissions**    | Repository pull requests & metadata       | Read-only access to user's authorized repos   |
| **Token Storage**  | Ephemeral in-memory (1 hour GitHub TTL)   | AES-256-GCM encrypted in PostgreSQL           |
| **Operations**     | Read PR diffs, publish advisory reviews   | Read-only inspection of metrics & telemetry   |

### Security Safeguards

- **PKCE S256 (RFC 7636)**: Every OAuth initiation creates a 43–128 character cryptographically random `code_verifier`, derives a SHA-256 `code_challenge`, and passes `code_challenge_method=S256`. OAuth transactions expire in 10 minutes and cannot be replayed.
- **AES-256-GCM Token Encryption**: User access tokens returned by GitHub are encrypted at rest using AES-256-GCM with a 12-byte initialization vector (IV) and 16-byte authentication tag (`${ivHex}:${tagHex}:${ciphertextHex}`).
- **Opaque Session Tokens**: Dashboard users receive a high-entropy 32-byte opaque session token via an `httpOnly`, `sameSite: "lax"`, `secure` (in production) cookie (`reviewlens_session`). The database stores only the SHA-256 hash of this token.
- **Double-Submit CSRF Protection**: State-changing requests (`POST`, `PUT`, `DELETE`) require a matching `x-csrf-token` header validated against the `reviewlens_csrf` cookie.
- **Anti-Enumeration 404s**: If an authenticated user queries `/api/reviews/:id` for a repository they do not have access to, the API returns HTTP 404 rather than 403, preventing attackers from confirming the existence of private review runs.
- **Sliding-Window Rate Limiting**: Authentication endpoints are rate-limited in-memory to prevent brute-force attacks (30 requests per 15 minutes per IP).

---

## 3. Database Schema Extensions

Prisma schema additions introduced in M6:

```prisma
model User {
  id           String    @id @default(uuid())
  githubUserId String    @unique
  githubLogin  String
  avatarUrl    String?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  lastLoginAt  DateTime?

  sessions      Session[]
  userGrants    UserInstallationGrant[]
  repoGrants    UserRepositoryGrant[]
}

model Session {
  id                       String    @id @default(uuid())
  tokenHash                String    @unique
  userId                   String
  encryptedGitHubAccessToken String
  expiresAt                DateTime
  createdAt                DateTime  @default(now())
  revokedAt                DateTime?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model OAuthTransaction {
  id           String   @id @default(uuid())
  state        String   @unique
  codeVerifier String
  expiresAt    DateTime
  createdAt    DateTime @default(now())
}

model UserInstallationGrant {
  id                   String   @id @default(uuid())
  userId               String
  installationGithubId String
  accountLogin         String
  accountType          String
  accountAvatarUrl     String?
  repositoryCount      Int      @default(0)
  refreshedAt          DateTime @default(now())
  expiresAt            DateTime

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model UserRepositoryGrant {
  id                   String   @id @default(uuid())
  userId               String
  installationGithubId String
  repositoryGithubId   String
  fullName             String
  permissions          Json?
  refreshedAt          DateTime @default(now())
  expiresAt            DateTime

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model ReviewFinding {
  id             String    @id @default(uuid())
  reviewRunId    String
  fingerprint    String
  provenance     String
  ruleId         String?
  modelId        String?
  category       String
  severity       String
  title          String
  description    String
  recommendation String
  confidence     Float?
  filePath       String?
  line           Int?
  side           String?
  scope          String
  createdAt      DateTime  @default(now())

  reviewRun ReviewRun @relation(fields: [reviewRunId], references: [id], onDelete: Cascade)
}
```

---

## 4. API Endpoints

### Authentication Routes

| Endpoint                    | Method | Description                                                                             |
| :-------------------------- | :----- | :-------------------------------------------------------------------------------------- |
| `/api/auth/github`          | `GET`  | Initiates GitHub OAuth authorization flow with PKCE S256 challenge                      |
| `/api/auth/github/callback` | `GET`  | Handles OAuth redirect, verifies state & PKCE verifier, exchanges code, creates session |
| `/api/auth/me`              | `GET`  | Returns current user session state (`{ authenticated: boolean, user?: User }`)          |
| `/api/auth/csrf`            | `GET`  | Generates and sets double-submit CSRF cookie and returns token                          |
| `/api/auth/logout`          | `POST` | Revokes the current session and clears cookies (requires CSRF)                          |

### Dashboard & Telemetry Routes (Protected)

| Endpoint                     | Method | Description                                                                         |
| :--------------------------- | :----- | :---------------------------------------------------------------------------------- |
| `/api/installations`         | `GET`  | Lists GitHub App installations accessible to the authenticated user                 |
| `/api/repositories`          | `GET`  | Lists authorized repositories with search, sorting, and pagination                  |
| `/api/dashboard/overview`    | `GET`  | Aggregated metrics: total repositories, total reviews, severity counts, recent runs |
| `/api/reviews`               | `GET`  | Paginated review history filtered by repository or review status                    |
| `/api/reviews/:id`           | `GET`  | Complete metadata, diff counts, and execution summary for a specific review         |
| `/api/reviews/:id/findings`  | `GET`  | All validated findings for the review with line numbers and provenance              |
| `/api/reviews/:id/execution` | `GET`  | Granular AI telemetry (chunk attempts, latency, token consumption, fallback models) |

---

## 5. Web Frontend

The dashboard application is located in `apps/web` and built with:

- **React 19**
- **Vite 8**
- **Tailwind CSS v4**
- **TanStack Query v5**

### Client-Side Routes

- `#/`: **Overview Dashboard** — High-level metric cards, finding severity breakdown, and recent pull request reviews.
- `#/installations`: **Installations View** — GitHub accounts and organizations where ReviewLens is active and accessible.
- `#/repositories`: **Repository Directory** — Filterable list of authorized repositories, access permissions, review counts, and latest run statuses.
- `#/reviews`: **Review History** — Paginated review audit log with status filtering.
- `#/reviews/:id`: **Review Details** — Deep tabbed view containing:
  - **Summary**: PR diff metadata, execution duration, and failure/degraded warnings.
  - **Findings**: Code defect cards with line coordinates, severity badges, confidence scores, and recommendations.
  - **AI Execution**: Transparency view with token counts, chunk attempts, latency breakdown, and model fallback audit.
- `#/login`: **Sign In Page** — Explains security guarantees and initiates OAuth flow.

---

## 6. Local Setup and Developer Configuration

### 1. Configure GitHub App OAuth Credentials

In your GitHub App settings (under **Developer Settings** $\to$ **GitHub Apps** $\to$ Your App):

1. **Callback URL**: Set to `http://localhost:3001/api/auth/github/callback` (or your staging domain).
2. **Request user authorization (OAuth) during installation**: Checked.
3. Note your **Client ID** and generate a **Client Secret**.

### 2. Environment Variables

Add the following to your root `.env` or `apps/api/.env`:

```bash
# GitHub App OAuth Credentials
GITHUB_CLIENT_ID=your_client_id_here
GITHUB_CLIENT_SECRET=your_client_secret_here
GITHUB_OAUTH_CALLBACK_URL=http://localhost:3001/api/auth/github/callback

# 32-byte hex key for AES-256-GCM token encryption
SESSION_ENCRYPTION_KEY=00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff

# Frontend URL
FRONTEND_URL=http://localhost:5173
```

### 3. Run Migrations

```bash
npx prisma migrate deploy
npm run prisma:generate
```

### 4. Start Development Servers

```bash
# Start both backend API (port 3001) and web dashboard (port 5173)
npm run dev
```

Visit `http://localhost:5173` in your browser.
