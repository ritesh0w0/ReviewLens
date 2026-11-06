#!/usr/bin/env bash
# ==============================================================================
# ReviewLens Production Operations & Health Diagnostics Check
# ==============================================================================
set -euo pipefail

COMPOSE_DIR="/opt/reviewlens/compose"
COMPOSE_FILE="${COMPOSE_DIR}/compose.prod.yaml"
RELEASE_ENV="${COMPOSE_DIR}/release.env"
DOMAIN="apidash-7f29a6.centralindia.cloudapp.azure.com"

echo "================================================================================"
echo " ReviewLens Operations Health Check — $(date -u +'%Y-%m-%dT%H:%M:%SZ')"
echo "================================================================================"

# 1. System Resources
echo ""
echo "--- 1. Host System Resources ---"
uptime
echo "Memory & Swap:"
free -h
echo "Root Disk:"
df -h / | awk 'NR==1 || NR==2'

# 2. TLS Certificate Expiry
echo ""
echo "--- 2. Public TLS Certificate ---"
if command -v openssl >/dev/null 2>&1; then
  CERT_EXPIRY=$(echo | openssl s_client -connect "${DOMAIN}:443" -servername "${DOMAIN}" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 || echo "Unknown")
  echo "TLS Certificate Expiry Date: $CERT_EXPIRY"
  if [[ "$CERT_EXPIRY" != "Unknown" ]]; then
    EXPIRY_EPOCH=$(date -d "$CERT_EXPIRY" +%s)
    NOW_EPOCH=$(date +%s)
    DAYS_LEFT=$(( (EXPIRY_EPOCH - NOW_EPOCH) / 86400 ))
    echo "Days remaining: $DAYS_LEFT days"
    if [[ $DAYS_LEFT -lt 14 ]]; then
      echo "WARNING: TLS Certificate expires in less than 14 days!"
    fi
  fi
fi

# 3. Docker Containers Status
echo ""
echo "--- 3. ReviewLens Container Status ---"
cd "$COMPOSE_DIR"
docker compose -f "$COMPOSE_FILE" ps

# 4. HTTP Endpoints Probe
echo ""
echo "--- 4. HTTP Endpoints Verification ---"
echo -n "API /healthz (Loopback): "
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001/healthz || echo "FAILED"

echo -n "API /readyz (Loopback): "
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001/readyz || echo "FAILED"

echo -n "Web /healthz (Loopback): "
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/healthz || echo "FAILED"

echo -n "Public HTTPS /reviewlens/api/healthz: "
curl -s -o /dev/null -w "%{http_code}\n" "https://${DOMAIN}/reviewlens/api/healthz" || echo "FAILED"

echo -n "Public HTTPS /reviewlens/ (Web SPA): "
curl -s -o /dev/null -w "%{http_code}\n" "https://${DOMAIN}/reviewlens/" || echo "FAILED"

# 5. Database & pg-boss Queue State
echo ""
echo "--- 5. Database & Job Queue State ---"
if docker ps --format '{{.Names}}' | grep -q 'reviewlens-postgres'; then
  QUEUE_METRICS=$(docker exec reviewlens-postgres psql -U reviewlens -d reviewlens -t -c "
    SELECT count(*) FROM pgboss.job WHERE state = 'created'
  " 2>/dev/null || echo "N/A")
  ACTIVE_JOBS=$(docker exec reviewlens-postgres psql -U reviewlens -d reviewlens -t -c "
    SELECT count(*) FROM pgboss.job WHERE state = 'active'
  " 2>/dev/null || echo "N/A")
  FAILED_JOBS=$(docker exec reviewlens-postgres psql -U reviewlens -d reviewlens -t -c "
    SELECT count(*) FROM pgboss.job WHERE state = 'failed'
  " 2>/dev/null || echo "N/A")
  COMPLETED_JOBS=$(docker exec reviewlens-postgres psql -U reviewlens -d reviewlens -t -c "
    SELECT count(*) FROM pgboss.job WHERE state = 'completed'
  " 2>/dev/null || echo "N/A")

  echo "Queued jobs (pending):   ${QUEUE_METRICS// /}"
  echo "Active jobs (running):   ${ACTIVE_JOBS// /}"
  echo "Failed jobs (error):     ${FAILED_JOBS// /}"
  echo "Completed jobs (done):   ${COMPLETED_JOBS// /}"
else
  echo "PostgreSQL container not running!"
fi

# 6. Coexistence Audit (APIDash & TrackFlow)
echo ""
echo "--- 6. Coexistence Audit (APIDash & TrackFlow) ---"
echo -n "APIDash systemd service: "
systemctl is-active apidash-api || echo "INACTIVE"
echo -n "APIDash port 5000: "
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5000/api/health || echo "FAILED"

echo -n "TrackFlow systemd service: "
systemctl is-active trackflow-api || echo "INACTIVE"
echo -n "TrackFlow port 5001: "
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5001/api/health || echo "FAILED"

# 7. Recent Error Logs (Bounded)
echo ""
echo "--- 7. Recent Container Errors (Last 15 lines) ---"
echo "API Errors:"
docker logs --tail=100 reviewlens-api 2>&1 | grep -iE 'error|fatal|fail' | tail -n 5 || echo "No recent API errors."
echo "Worker Errors:"
docker logs --tail=100 reviewlens-worker 2>&1 | grep -iE 'error|fatal|fail' | tail -n 5 || echo "No recent Worker errors."

echo ""
echo "================================================================================"
echo " Operations Check Completed."
echo "================================================================================"
