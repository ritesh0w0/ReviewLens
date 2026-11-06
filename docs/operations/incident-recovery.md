# ReviewLens — Incident Response & Recovery Guide

**Scope:** Production Azure Host (`apidash-7f29a6.centralindia.cloudapp.azure.com`)  
**Architecture:** Co-located Docker Compose deployment alongside APIDash and TrackFlow.

> [!CAUTION]
> **Data Loss Policy & Backup Notice**  
> ReviewLens operates on a dedicated PostgreSQL named volume (`reviewlens_pgdata`). By explicit design decision, **automated database backups, Blob snapshots, and restore systems are not configured**. Catastrophic VM failure, volume deletion, or disk corruption will result in unrecoverable data loss. Under no circumstances should `docker compose down -v` or disk formatting commands be executed.

---

## 1. Quick Triage: Diagnostic Command

Run the non-destructive operations diagnostic check:

```bash
ssh azureuser@20.219.5.208 "sudo /opt/reviewlens/bin/ops-check.sh"
```

---

## 2. Incident Runbooks

### 2.1 Frontend Unavailable (HTTP 404, 502, or Blank Screen)

- **Symptoms:** Visiting `https://.../reviewlens/` returns 502 Bad Gateway or Nginx error page.
- **Diagnostic Commands:**
  ```bash
  ssh azureuser@20.219.5.208 "sudo docker ps -f name=reviewlens-web; curl -sI http://127.0.0.1:3000/healthz"
  ```
- **Healthy Output:** Container `reviewlens-web` is `Up (healthy)` and curl returns `HTTP/1.1 200 OK`.
- **Corrective Action:**
  ```bash
  ssh azureuser@20.219.5.208 "cd /opt/reviewlens/compose && sudo docker compose -f compose.prod.yaml restart web"
  ```
- **What Must Not Be Touched:** Do not reload or restart host Nginx before verifying `reviewlens-web` container status. Do not modify APIDash or TrackFlow proxy blocks.
- **Verification:** `curl -sI https://apidash-7f29a6.centralindia.cloudapp.azure.com/reviewlens/` returns 200.

---

### 2.2 API Unavailable (HTTP 502 or Connection Refused)

- **Symptoms:** `GET /reviewlens/api/healthz` returns 502 or 503.
- **Diagnostic Commands:**
  ```bash
  ssh azureuser@20.219.5.208 "sudo docker logs --tail=50 reviewlens-api; sudo docker ps -f name=reviewlens-api"
  ```
- **Healthy Output:** `reviewlens-api` is `Up (healthy)`, logs state `"msg":"ReviewLens API listening"`.
- **Corrective Action:**
  ```bash
  ssh azureuser@20.219.5.208 "cd /opt/reviewlens/compose && sudo docker compose -f compose.prod.yaml restart api"
  ```
- **What Must Not Be Touched:** Do not edit `/opt/reviewlens/secrets/prod.env` or modify port 3001 binding.

---

### 2.3 API Readiness Failure (`/readyz` returns HTTP 503)

- **Symptoms:** `GET /reviewlens/api/healthz` is 200, but `/reviewlens/api/readyz` returns 503 `{"status":"not_ready","database":"disconnected"}`.
- **Diagnostic Commands:**
  ```bash
  ssh azureuser@20.219.5.208 "sudo docker ps -f name=reviewlens-postgres; sudo docker exec reviewlens-postgres pg_isready -U reviewlens -d reviewlens"
  ```
- **Healthy Output:** `reviewlens:5432 - accepting connections`.
- **Corrective Action:**
  If PostgreSQL container stopped, start it:
  ```bash
  ssh azureuser@20.219.5.208 "cd /opt/reviewlens/compose && sudo docker compose -f compose.prod.yaml start postgres && sleep 3 && sudo docker compose -f compose.prod.yaml restart api worker"
  ```

---

### 2.4 Worker Stopped or Unhealthy

- **Symptoms:** PR webhooks are acknowledged, but reviews are never posted; pg-boss queue backlog increases.
- **Diagnostic Commands:**
  ```bash
  ssh azureuser@20.219.5.208 "sudo docker ps -f name=reviewlens-worker; sudo docker logs --tail=50 reviewlens-worker"
  ```
- **Healthy Output:** `reviewlens-worker` is `Up`, logs state `"msg":"ReviewLens worker handlers registered and listening for jobs"`.
- **Corrective Action:**
  Restart worker:
  ```bash
  ssh azureuser@20.219.5.208 "cd /opt/reviewlens/compose && sudo docker compose -f compose.prod.yaml restart worker"
  ```

---

### 2.5 Queue Backlog or Stuck Jobs

- **Symptoms:** Jobs in `created` state accumulating in pg-boss without completion.
- **Diagnostic Commands:**
  ```bash
  ssh azureuser@20.219.5.208 "sudo docker exec reviewlens-postgres psql -U reviewlens -d reviewlens -c 'SELECT id, name, state, retrycount, createdon FROM pgboss.job WHERE state IN (\x27created\x27, \x27active\x27, \x27failed\x27) ORDER BY createdon DESC LIMIT 10;'"
  ```
- **Corrective Action:**
  Check worker logs for unhandled exceptions or rate limits with GitHub/Gemini/Groq. Ensure worker process is running and connected.

---

### 2.6 Failed Deployment / Rollback Procedure

- **Symptoms:** Newly deployed container crashes, fails health checks, or exhibits regression.
- **Triggering Rollback:**
  ```bash
  ssh azureuser@20.219.5.208 "sudo /opt/reviewlens/bin/deploy.sh --rollback"
  ```
- **Rollback Behavior:**
  - Restores `/opt/reviewlens/compose/release.env.previous`.
  - Recreates `api`, `worker`, and `web` with previous image digests.
  - Automatically executes health checks.
- **Note on Database Migrations:** Rollback reverts container images. It does not automatically revert Prisma database migrations (expand/contract schema pattern is maintained).

---

### 2.7 High RAM, Swap, or Disk Pressure

- **Symptoms:** Host free memory drops below 500 MB; swap utilization rises; disk usage exceeds 85%.
- **Diagnostic Commands:**
  ```bash
  ssh azureuser@20.219.5.208 "free -h; swapon --show; df -h /; sudo docker stats --no-stream"
  ```
- **Corrective Action:**
  ReviewLens has strict memory caps: 384 MB (API), 384 MB (Worker), 384 MB (PostgreSQL), 128 MB (Web). Total maximum footprint is 1,280 MB.
  Clean untagged Docker build layers safely:
  ```bash
  ssh azureuser@20.219.5.208 "sudo docker image prune -f"
  ```
  _(Never run `docker system prune -a` or volume prune)._

---

### 2.8 TLS Certificate Nearing Expiry or Expired

- **Symptoms:** Browser TLS warnings when visiting `https://apidash-7f29a6.centralindia.cloudapp.azure.com/`.
- **Diagnostic Commands:**
  ```bash
  ssh azureuser@20.219.5.208 "sudo certbot certificates"
  ```
- **Corrective Action:**
  ```bash
  ssh azureuser@20.219.5.208 "sudo certbot renew --dry-run && sudo certbot renew && sudo systemctl reload nginx"
  ```

---

### 2.9 OAuth Authentication Failure

- **Symptoms:** Clicking "Continue with GitHub" results in error redirect or 503.
- **Diagnostic Commands:**
  ```bash
  ssh azureuser@20.219.5.208 "sudo docker logs --tail=50 reviewlens-api | grep -iE 'oauth|auth'"
  ```
- **Checklist:**
  - Verify `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in `/opt/reviewlens/secrets/prod.env`.
  - Verify "Authorization callback URL" on GitHub App exactly equals:
    `https://apidash-7f29a6.centralindia.cloudapp.azure.com/reviewlens/api/auth/github/callback`
  - Verify `FRONTEND_URL` in `prod.env` is `https://apidash-7f29a6.centralindia.cloudapp.azure.com/reviewlens`.

---

### 2.10 Webhook Signature Verification Failure (HTTP 401)

- **Symptoms:** GitHub App settings page shows red webhook delivery status with `401 Unauthorized`.
- **Diagnostic Commands:**
  ```bash
  ssh azureuser@20.219.5.208 "sudo docker logs --tail=50 reviewlens-api | grep -iE 'webhook|signature'"
  ```
- **Corrective Action:**
  - The secret configured under "Webhook secret" on GitHub must match `GITHUB_WEBHOOK_SECRET` in `/opt/reviewlens/secrets/prod.env`.
  - Restart API if secret was edited: `sudo docker compose restart api`.

---

### 2.11 GitHub App Private Key / Permission Errors

- **Symptoms:** Worker logs show `"GitHub App credentials (GITHUB_APP_ID, GITHUB_PRIVATE_KEY) are not configured"` or JWT signature failure.
- **Diagnostic Commands:**
  ```bash
  ssh azureuser@20.219.5.208 "sudo docker exec reviewlens-worker ls -la /opt/reviewlens/secrets/github_private_key.pem"
  ```
- **Corrective Action:**
  - Verify key file permissions: `sudo chmod 644 /opt/reviewlens/secrets/github_private_key.pem`.
  - Verify volume mount in `/opt/reviewlens/compose/compose.prod.yaml` contains `- /opt/reviewlens/secrets:/opt/reviewlens/secrets:ro`.
  - Restart worker: `sudo docker compose restart worker`.
