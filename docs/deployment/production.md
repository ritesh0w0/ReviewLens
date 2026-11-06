# ReviewLens — Production Deployment Guide

**Target Host:** `apidash-7f29a6.centralindia.cloudapp.azure.com` (Azure Ubuntu 24.04 LTS, IP: `20.219.5.208`)  
**Base Directory:** `/opt/reviewlens`

---

## 1. Production Architecture Overview

ReviewLens is deployed alongside **APIDash** and **TrackFlow** on an Azure `Standard_B2ls_v2` instance (2 vCPU, 4 GB RAM).

### Port & Routing Allocation

| Application           | Routing Path                        | Host Listening Port   | Runtime Mode                             |
| :-------------------- | :---------------------------------- | :-------------------- | :--------------------------------------- |
| **APIDash**           | `/` and `/api/`                     | `127.0.0.1:5000`      | Native systemd (`apidash-api.service`)   |
| **TrackFlow**         | `/trackflow/` and `/trackflow/api/` | `127.0.0.1:5001`      | Native systemd (`trackflow-api.service`) |
| **ReviewLens Web**    | `/reviewlens/`                      | `127.0.0.1:3000`      | Docker Compose (`reviewlens-web`)        |
| **ReviewLens API**    | `/reviewlens/api/`                  | `127.0.0.1:3001`      | Docker Compose (`reviewlens-api`)        |
| **ReviewLens DB**     | None (Private)                      | None (Internal: 5432) | Docker Compose (`reviewlens-postgres`)   |
| **ReviewLens Worker** | None (Private)                      | None                  | Docker Compose (`reviewlens-worker`)     |

---

## 2. Host Prerequisites & Configuration

### 2.1 2 GB Swapfile Provisioning

To avoid out-of-memory kernel events across three running applications:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 2.2 Docker & Compose Installation

Installed from the official Docker apt repository for Ubuntu Noble (24.04):

```bash
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker azureuser
```

---

## 3. ReviewLens Directory Structure

```text
/opt/reviewlens/
├── bin/
│   ├── deploy.sh           # Root-owned deployment wrapper (0755)
│   └── ops-check.sh        # Health and diagnostics script (0755)
├── compose/
│   ├── compose.prod.yaml   # Production Compose specification
│   ├── release.env         # Active image digests manifest
│   └── release.env.previous# Rollback release manifest
└── secrets/
    ├── github_private_key.pem # GitHub App RSA private key (0644)
    └── prod.env            # Production environment variables (0600)
```

---

## 4. Nginx Subpath Configuration

ReviewLens is routed via `/etc/nginx/snippets/reviewlens.conf`:

```nginx
# ReviewLens Isolated Configuration Snippet

location = /reviewlens {
    return 301 /reviewlens/;
}

location ^~ /reviewlens/api/ {
    proxy_pass http://127.0.0.1:3001/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";

    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
}

location ^~ /reviewlens/ {
    proxy_pass http://127.0.0.1:3000/reviewlens/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
}
```

Included in `/etc/nginx/sites-available/apidash`:

```nginx
include /etc/nginx/snippets/trackflow.conf;
include /etc/nginx/snippets/reviewlens.conf;
```

---

## 5. Health Verification Commands

```bash
# Check container status
ssh azureuser@20.219.5.208 "sudo /opt/reviewlens/bin/ops-check.sh"

# Test public endpoints
curl -sI https://apidash-7f29a6.centralindia.cloudapp.azure.com/reviewlens/
curl -sI https://apidash-7f29a6.centralindia.cloudapp.azure.com/reviewlens/api/healthz
curl -sI https://apidash-7f29a6.centralindia.cloudapp.azure.com/reviewlens/api/readyz
```
