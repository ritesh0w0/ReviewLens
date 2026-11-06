#!/usr/bin/env bash
# ==============================================================================
# ReviewLens Controlled Production Deployment & Rollback Script
# ==============================================================================
set -euo pipefail

COMPOSE_DIR="/opt/reviewlens/compose"
COMPOSE_FILE="${COMPOSE_DIR}/compose.prod.yaml"
RELEASE_ENV="${COMPOSE_DIR}/release.env"
PREV_RELEASE_ENV="${COMPOSE_DIR}/release.env.previous"
SECRETS_FILE="/opt/reviewlens/secrets/prod.env"

SERVER_REPO="ghcr.io/ritesh0w0/reviewlens-server"
WEB_REPO="ghcr.io/ritesh0w0/reviewlens-web"

log() {
  echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $*"
}

error() {
  echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] ERROR: $*" >&2
}

validate_digest() {
  local digest="$1"
  if [[ ! "$digest" =~ ^sha256:[a-f0-9]{64}$ ]]; then
    error "Invalid image digest format: '$digest'. Expected format: 'sha256:<64-hex>'."
    exit 1
  fi
}

health_gate() {
  log "Waiting for ReviewLens services to become healthy..."
  local max_attempts=30
  local attempt=1
  local healthy=false

  while [[ $attempt -le $max_attempts ]]; do
    local api_status
    local ready_status
    local web_status

    api_status=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/healthz || echo "000")
    ready_status=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/readyz || echo "000")
    web_status=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/healthz || echo "000")

    if [[ "$api_status" == "200" && "$ready_status" == "200" && "$web_status" == "200" ]]; then
      healthy=true
      break
    fi

    log "Health check attempt $attempt/$max_attempts: API=$api_status Ready=$ready_status Web=$web_status. Retrying in 2s..."
    sleep 2
    ((attempt++))
  done

  if [[ "$healthy" != "true" ]]; then
    error "Health gate timed out after $((max_attempts * 2)) seconds."
    return 1
  fi

  log "Health gate passed successfully. All endpoints returned HTTP 200 OK."
  return 0
}

rollback() {
  log "Initiating ReviewLens-only rollback..."
  if [[ ! -f "$PREV_RELEASE_ENV" ]]; then
    error "No previous release manifest found at $PREV_RELEASE_ENV. Cannot roll back."
    exit 1
  fi

  cp "$PREV_RELEASE_ENV" "$RELEASE_ENV"
  log "Restored previous release manifest: $(cat "$RELEASE_ENV")"

  cd "$COMPOSE_DIR"
  docker compose --env-file "$RELEASE_ENV" -f "$COMPOSE_FILE" up -d --remove-orphans api worker web

  if health_gate; then
    log "Rollback completed successfully."
    exit 0
  else
    error "Rollback failed health gate. Human intervention required."
    exit 1
  fi
}

deploy() {
  local server_digest="$1"
  local web_digest="$2"

  validate_digest "$server_digest"
  validate_digest "$web_digest"

  local server_ref="${SERVER_REPO}@${server_digest}"
  local web_ref="${WEB_REPO}@${web_digest}"

  log "Starting deployment for ReviewLens:"
  log "  Server Image: $server_ref"
  log "  Web Image:    $web_ref"

  # Backup current release if it exists
  if [[ -f "$RELEASE_ENV" ]]; then
    cp "$RELEASE_ENV" "$PREV_RELEASE_ENV"
    log "Backed up current release manifest to $PREV_RELEASE_ENV."
  fi

  # Atomic write of release environment
  local tmp_env="${RELEASE_ENV}.tmp.$$"
  cat > "$tmp_env" <<EOF
SERVER_IMAGE_REF=${server_ref}
WEB_IMAGE_REF=${web_ref}
EOF
  mv "$tmp_env" "$RELEASE_ENV"
  log "Wrote release manifest to $RELEASE_ENV."

  cd "$COMPOSE_DIR"

  # Validate compose configuration
  log "Validating Docker Compose configuration..."
  docker compose --env-file "$RELEASE_ENV" -f "$COMPOSE_FILE" config > /dev/null

  # Pull images if needed
  log "Pulling release images..."
  docker pull "$server_ref"
  docker pull "$web_ref"

  # Apply Prisma migrations (one-off job)
  log "Deploying database migrations..."
  docker compose --env-file "$RELEASE_ENV" -f "$COMPOSE_FILE" run --rm migrator

  # Update services
  log "Updating ReviewLens services..."
  docker compose --env-file "$RELEASE_ENV" -f "$COMPOSE_FILE" up -d --remove-orphans postgres api worker web

  # Run health gate with auto-rollback on failure
  if ! health_gate; then
    error "Deployment health gate failed! Triggering automatic rollback..."
    rollback
  fi

  log "Deployment completed successfully. ReviewLens is live."
}

# ------------------------------------------------------------------------------
# Argument Parsing
# ------------------------------------------------------------------------------
SERVER_DIGEST=""
WEB_DIGEST=""
ACTION="deploy"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server-digest)
      SERVER_DIGEST="$2"
      shift 2
      ;;
    --web-digest)
      WEB_DIGEST="$2"
      shift 2
      ;;
    --rollback)
      ACTION="rollback"
      shift
      ;;
    --status)
      ACTION="status"
      shift
      ;;
    -h|--help)
      echo "Usage: $0 --server-digest <sha256:...> --web-digest <sha256:...>"
      echo "       $0 --rollback"
      echo "       $0 --status"
      exit 0
      ;;
    *)
      error "Unknown option: $1"
      exit 1
      ;;
  esac
done

case "$ACTION" in
  deploy)
    if [[ -z "$SERVER_DIGEST" || -z "$WEB_DIGEST" ]]; then
      error "Both --server-digest and --web-digest are required for deployment."
      exit 1
    fi
    deploy "$SERVER_DIGEST" "$WEB_DIGEST"
    ;;
  rollback)
    rollback
    ;;
  status)
    cd "$COMPOSE_DIR"
    if [[ -f "$RELEASE_ENV" ]]; then
      docker compose --env-file "$RELEASE_ENV" -f "$COMPOSE_FILE" ps
    else
      docker compose -f "$COMPOSE_FILE" ps
    fi
    ;;
esac
