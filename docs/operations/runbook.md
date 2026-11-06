# ReviewLens — Production Operations Runbook

**Target Host:** `apidash-7f29a6.centralindia.cloudapp.azure.com` (Azure Ubuntu 24.04 LTS, IP: `20.219.5.208`)  
**Deployment Base:** `/opt/reviewlens`

---

## 1. Routine Operational Commands

### 1.1 Full Operational Health Check

Runs resource checks, endpoint probes, job queue queries, and coexistence audit:

```bash
ssh azureuser@20.219.5.208 "sudo /opt/reviewlens/bin/ops-check.sh"
```

### 1.2 Inspecting Active Services

```bash
ssh azureuser@20.219.5.208 "cd /opt/reviewlens/compose && sudo docker compose -f compose.prod.yaml ps"
```

### 1.3 Streaming Application Logs

```bash
# API logs
ssh azureuser@20.219.5.208 "cd /opt/reviewlens/compose && sudo docker compose -f compose.prod.yaml logs -f api"

# Background Review Worker logs
ssh azureuser@20.219.5.208 "cd /opt/reviewlens/compose && sudo docker compose -f compose.prod.yaml logs -f worker"

# Web Nginx access/error logs
ssh azureuser@20.219.5.208 "cd /opt/reviewlens/compose && sudo docker compose -f compose.prod.yaml logs -f web"
```

---

## 2. Service Management (ReviewLens-Only)

### 2.1 Restarting Application Containers

Restarts only the ReviewLens backend and worker without disturbing database or other applications:

```bash
ssh azureuser@20.219.5.208 "cd /opt/reviewlens/compose && sudo docker compose -f compose.prod.yaml restart api worker"
```

### 2.2 Restarting Nginx Safely

Nginx proxies APIDash, TrackFlow, and ReviewLens. Always test syntax before reloading:

```bash
ssh azureuser@20.219.5.208 "sudo nginx -t && sudo systemctl reload nginx"
```

---

## 3. Production Deployment & Rollback

### 3.1 Deploying a New Image Set

To deploy new immutable image digests:

```bash
ssh azureuser@20.219.5.208 "sudo /opt/reviewlens/bin/deploy.sh \
  --server-digest sha256:<64-hex-digest> \
  --web-digest sha256:<64-hex-digest>"
```

The script automatically:

1. Validates digest formats.
2. Backs up `release.env` to `release.env.previous`.
3. Pulls images.
4. Executes Prisma migrations.
5. Updates containers.
6. Waits for the health gate (`/healthz` + `/readyz`).
7. Automatically rolls back if the health gate fails.

### 3.2 Manual Rollback

```bash
ssh azureuser@20.219.5.208 "sudo /opt/reviewlens/bin/deploy.sh --rollback"
```

---

## 4. Secret & Credential Maintenance

### 4.1 Updating Application Secrets

Secrets are located in `/opt/reviewlens/secrets/prod.env` with `0600` permissions.
To update API keys or secrets:

```bash
ssh azureuser@20.219.5.208 "nano /opt/reviewlens/secrets/prod.env"
ssh azureuser@20.219.5.208 "cd /opt/reviewlens/compose && sudo docker compose -f compose.prod.yaml restart api worker"
```

### 4.2 Rotating GitHub App Private Key

1. Upload the new PEM file to `/opt/reviewlens/secrets/github_private_key.pem`.
2. Ensure correct permissions:
   ```bash
   ssh azureuser@20.219.5.208 "sudo chmod 644 /opt/reviewlens/secrets/github_private_key.pem"
   ```
3. Restart worker:
   ```bash
   ssh azureuser@20.219.5.208 "cd /opt/reviewlens/compose && sudo docker compose -f compose.prod.yaml restart worker"
   ```
