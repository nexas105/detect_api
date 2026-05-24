#!/bin/bash
set -euo pipefail

# ── Colors ──────────────────────────────────────────────────────────────────
BOLD='\033[1m'
DIM='\033[2m'
CYAN='\033[36m'
GREEN='\033[32m'
YELLOW='\033[33m'
RESET='\033[0m'

# ── Helpers ─────────────────────────────────────────────────────────────────

gen_secret() {
  openssl rand -base64 "$1" | tr -d '/+=' | head -c "$2"
}

mask() {
  local val="$1"
  if [ ${#val} -le 4 ]; then
    echo "****"
  else
    echo "${val:0:4}$(printf '*%.0s' $(seq 1 $((${#val} - 4))))"
  fi
}

# Prompt user for a value. Output goes to /dev/tty (visible in terminal),
# the chosen value is printed to stdout for capture.
ask() {
  local label="$1"
  local default="$2"
  local is_secret="${3:-false}"

  local display_default="$default"
  if [ "$is_secret" = "true" ]; then
    display_default="$(mask "$default")"
  fi

  printf "${CYAN}  %s${RESET} [%s]: " "$label" "$display_default" >/dev/tty
  read -r input </dev/tty
  local value="${input:-$default}"

  if [ "$is_secret" = "true" ]; then
    printf "    -> %s\n" "$(mask "$value")" >/dev/tty
  else
    printf "    -> %s\n" "$value" >/dev/tty
  fi

  echo "$value"
}

# Check port availability — local or remote via SSH
_check_port_in_use() {
  local port="$1"
  if [ -n "$SSH_HOST" ]; then
    # Remote check via SSH
    ssh -o ConnectTimeout=3 "$SSH_HOST" "lsof -i :$port -sTCP:LISTEN" >/dev/null 2>&1
  else
    # Local check
    lsof -i :"$port" -sTCP:LISTEN >/dev/null 2>&1
  fi
}

_get_port_process() {
  local port="$1"
  if [ -n "$SSH_HOST" ]; then
    ssh -o ConnectTimeout=3 "$SSH_HOST" "lsof -i :$port -sTCP:LISTEN -t 2>/dev/null | head -1" 2>/dev/null || echo ""
  else
    lsof -i :"$port" -sTCP:LISTEN -t 2>/dev/null | head -1
  fi
}

# Ask for a port — checks if available (local or remote), retries if blocked
ask_port() {
  local label="$1"
  local default="$2"
  local scan_target="local"
  [ -n "$SSH_HOST" ] && scan_target="$SSH_HOST"

  while true; do
    printf "${CYAN}  %s${RESET} [%s]: " "$label" "$default" >/dev/tty
    read -r input </dev/tty
    local port="${input:-$default}"

    # Validate numeric
    if ! [[ "$port" =~ ^[0-9]+$ ]] || [ "$port" -lt 1024 ] || [ "$port" -gt 65535 ]; then
      printf "    ${YELLOW}Invalid port. Use 1024-65535.${RESET}\n" >/dev/tty
      continue
    fi

    # Check if port is in use (local or remote)
    if _check_port_in_use "$port"; then
      local proc
      proc=$(_get_port_process "$port")
      printf "    ${YELLOW}Port %s blocked on %s (PID %s). Choose another.${RESET}\n" "$port" "$scan_target" "$proc" >/dev/tty
      default="$((port + 1))"
      continue
    fi

    # Check against already-assigned ports in this session
    if echo "$_ASSIGNED_PORTS" | grep -qw "$port"; then
      printf "    ${YELLOW}Port %s already assigned to another service. Choose another.${RESET}\n" "$port" >/dev/tty
      default="$((port + 1))"
      continue
    fi

    _ASSIGNED_PORTS="$_ASSIGNED_PORTS $port"
    printf "    -> %s ${GREEN}(available on %s)${RESET}\n" "$port" "$scan_target" >/dev/tty
    echo "$port"
    return
  done
}

_ASSIGNED_PORTS=""

# ── Check for existing files ───────────────────────────────────────────────

check_overwrite() {
  local files_exist=false
  for f in .env.local .env.prod .env.coolify; do
    if [ -f "$f" ]; then
      files_exist=true
      break
    fi
  done

  if [ "$files_exist" = "true" ]; then
    echo "" >/dev/tty
    printf "${YELLOW}  Existing env files found:${RESET}\n" >/dev/tty
    [ -f .env.local ]   && echo "    - .env.local" >/dev/tty
    [ -f .env.prod ]    && echo "    - .env.prod" >/dev/tty
    [ -f .env.coolify ] && echo "    - .env.coolify" >/dev/tty
    echo "" >/dev/tty
    printf "  Overwrite? [y/N]: " >/dev/tty
    read -r answer </dev/tty
    if [[ ! "$answer" =~ ^[Yy]$ ]]; then
      echo "" >/dev/tty
      echo "  Aborted. Existing files unchanged." >/dev/tty
      exit 0
    fi
    echo "" >/dev/tty
  fi
}

# ── Target selection ────────────────────────────────────────────────────────

ask_target() {
  echo "" >/dev/tty
  printf "${BOLD}  What do you want to set up?${RESET}\n" >/dev/tty
  echo "" >/dev/tty
  printf "    ${CYAN}1)${RESET} Local dev       ${DIM}(SQLite, localhost)          -> .env.local${RESET}\n" >/dev/tty
  printf "    ${CYAN}2)${RESET} Prod (Docker)   ${DIM}(PostgreSQL + Redis)         -> .env.prod${RESET}\n" >/dev/tty
  printf "    ${CYAN}3)${RESET} Coolify deploy  ${DIM}(Traefik + SSL + domains)    -> .env.coolify${RESET}\n" >/dev/tty
  printf "    ${CYAN}4)${RESET} All three       ${DIM}(local + prod + coolify)${RESET}\n" >/dev/tty
  echo "" >/dev/tty

  while true; do
    printf "  Choice [1-4]: " >/dev/tty
    read -r choice </dev/tty
    case "$choice" in
      1) TARGET="local";   echo "$TARGET"; return ;;
      2) TARGET="prod";    echo "$TARGET"; return ;;
      3) TARGET="coolify"; echo "$TARGET"; return ;;
      4) TARGET="all";     echo "$TARGET"; return ;;
      *) printf "    ${YELLOW}Invalid. Enter 1, 2, 3 or 4.${RESET}\n" >/dev/tty ;;
    esac
  done
}

section() {
  local num="$1" total="$2" title="$3"
  echo "" >/dev/tty
  printf "${BOLD}  [%s/%s] %s${RESET}\n" "$num" "$total" "$title" >/dev/tty
}

# ── Main ───────────────────────────────────────────────────────────────────

echo "" >/dev/tty
printf "${BOLD}  Erohub Environment Setup${RESET}\n" >/dev/tty
printf "${DIM}  Press Enter to accept defaults. Required fields are marked (required).${RESET}\n" >/dev/tty
if [ -n "$SSH_HOST" ]; then
  printf "${CYAN}  Remote port scan: %s${RESET}\n" "$SSH_HOST" >/dev/tty
  if ! ssh -o ConnectTimeout=3 "$SSH_HOST" "echo ok" >/dev/null 2>&1; then
    printf "${YELLOW}  SSH connection failed! Falling back to local scan.${RESET}\n" >/dev/tty
    SSH_HOST=""
  fi
fi

TARGET="$(ask_target)"

# Which targets are enabled?
WRITE_LOCAL=false; WRITE_PROD=false; WRITE_COOLIFY=false
case "$TARGET" in
  local)   WRITE_LOCAL=true ;;
  prod)    WRITE_PROD=true ;;
  coolify) WRITE_COOLIFY=true ;;
  all)     WRITE_LOCAL=true; WRITE_PROD=true; WRITE_COOLIFY=true ;;
esac

check_overwrite

# Auto-generate secrets upfront — shown as defaults so user sees they're set
DEFAULT_JWT_SECRET="$(gen_secret 48 48)"
DEFAULT_ADMIN_PASSWORD="$(gen_secret 24 20)"
DEFAULT_DB_PASSWORD="$(gen_secret 24 20)"
DEFAULT_INTERNAL_SECRET="$(gen_secret 48 48)"

echo "" >/dev/tty
printf "${DIM}  Auto-generated secrets (keep defaults = use these):${RESET}\n" >/dev/tty
printf "${DIM}    JWT Secret:       %s${RESET}\n" "$(mask "$DEFAULT_JWT_SECRET")" >/dev/tty
printf "${DIM}    Admin password:   %s${RESET}\n" "$(mask "$DEFAULT_ADMIN_PASSWORD")" >/dev/tty
printf "${DIM}    DB password:      %s${RESET}\n" "$(mask "$DEFAULT_DB_PASSWORD")" >/dev/tty
printf "${DIM}    Internal secret:  %s${RESET}\n" "$(mask "$DEFAULT_INTERNAL_SECRET")" >/dev/tty

# Count steps based on target
TOTAL_STEPS=3
[ "$WRITE_COOLIFY" = "true" ] && TOTAL_STEPS=4

# ── Step 1: Admin & Secrets (required) ──
section 1 "$TOTAL_STEPS" "Admin & Secrets (required)"
ADMIN_EMAIL="$(ask "Admin email" "admin@erohub.local")"
ADMIN_PASSWORD="$(ask "Admin password" "$DEFAULT_ADMIN_PASSWORD" true)"
JWT_SECRET="$(ask "JWT Secret" "$DEFAULT_JWT_SECRET" true)"
INTERNAL_AUTH_SECRET="$(ask "Internal service secret (API <-> Auth)" "$DEFAULT_INTERNAL_SECRET" true)"

# ── Step 2: Database (required if prod/coolify, skipped if only local) ──
section 2 "$TOTAL_STEPS" "Database (PostgreSQL credentials)"
if [ "$WRITE_LOCAL" = "true" ] && [ "$WRITE_PROD" = "false" ] && [ "$WRITE_COOLIFY" = "false" ]; then
  printf "${DIM}  Note: Local-only uses SQLite, but creds are saved for later prod use.${RESET}\n" >/dev/tty
fi
DB_USER="$(ask "DB User" "erohub")"
DB_PASSWORD="$(ask "DB Password" "$DEFAULT_DB_PASSWORD" true)"
DB_NAME="$(ask "DB Name" "erohub")"

# ── Step 3: Ports (required) ──
section 3 "$TOTAL_STEPS" "Service Ports"
API_PORT="$(ask_port "API Port" "8000")"
AUTH_PORT="$(ask_port "Auth Port" "8001")"
STUDIO_PORT="$(ask_port "Studio Port" "3000")"

echo "" >/dev/tty
printf "${DIM}  ML Workers: 0=inline ~2GB, 1=2GB, 2=2.8GB, 4=3.5GB  (dev: 0, prod: 2)${RESET}\n" >/dev/tty
ML_WORKERS="$(ask "ML Workers" "0")"

CORS_ORIGINS="$(ask "CORS Origins (local) (optional, comma-separated)" "http://localhost:${STUDIO_PORT}")"

# ── Step 4: Coolify Domains (only if coolify/all) ──
DOMAIN_STUDIO=""; DOMAIN_API=""; DOMAIN_AUTH=""
if [ "$WRITE_COOLIFY" = "true" ]; then
  section 4 "$TOTAL_STEPS" "Coolify Domains (required for .env.coolify)"
  printf "${DIM}  e.g. studio.example.com — Traefik routes https traffic via these.${RESET}\n" >/dev/tty
  DOMAIN_STUDIO="$(ask "Studio domain" "")"
  DOMAIN_API="$(ask "API domain" "")"
  DOMAIN_AUTH="$(ask "Auth domain" "")"
  if [ -z "$DOMAIN_STUDIO" ] || [ -z "$DOMAIN_API" ] || [ -z "$DOMAIN_AUTH" ]; then
    printf "${YELLOW}  All three domains required for Coolify. Skipping .env.coolify.${RESET}\n" >/dev/tty
    WRITE_COOLIFY=false
  fi
fi

# ── Derived values ─────────────────────────────────────────────────────────

NEXT_PUBLIC_AUTH_URL="http://localhost:${AUTH_PORT}"
NEXT_PUBLIC_API_URL="http://localhost:${API_PORT}"
AUTH_SERVICE_URL_LOCAL="http://localhost:${AUTH_PORT}"
AUTH_SERVICE_URL_PROD="http://auth:${AUTH_PORT}"
DATABASE_URL_LOCAL="sqlite+aiosqlite:///db/data/auth.db"
DATABASE_URL_PROD="postgresql+asyncpg://${DB_USER}:${DB_PASSWORD}@db:5432/${DB_NAME}"

# ── Write files ────────────────────────────────────────────────────────────

write_env() {
  local file="$1"
  local db_url="$2"
  local api_host="$3"
  local storage_dir="$4"
  local model_dir="$5"
  local auth_service_url="$6"
  local redis_url="$7"
  local ml_workers="$8"

  cat > "$file" <<ENVFILE
# API
STORAGE_DIR=${storage_dir}
MODEL_DIR=${model_dir}
API_PORT=${API_PORT}
API_HOST=${api_host}
AUTH_SERVICE_URL=${auth_service_url}

# Auth
AUTH_PORT=${AUTH_PORT}
JWT_SECRET=${JWT_SECRET}
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
INTERNAL_AUTH_SECRET=${INTERNAL_AUTH_SECRET}

# Database
DATABASE_URL=${db_url}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}
DB_NAME=${DB_NAME}
DB_PORT=5432
DB_DATA_DIR=./db/data

# Redis (optional — omit for in-memory fallback)
${redis_url}

# ML Workers (0=inline ~2GB, 1=2GB, 2=2.8GB, 4=3.5GB)
ML_WORKERS=${ml_workers}

# API Limits
MAX_UPLOAD_SIZE=52428800

# Studio
STUDIO_PORT=${STUDIO_PORT}

# Studio env
NEXT_PUBLIC_AUTH_URL=${NEXT_PUBLIC_AUTH_URL}
NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

# CORS
CORS_ORIGINS=${CORS_ORIGINS}
ENVFILE
}

WRITTEN_FILES=()

if [ "$WRITE_LOCAL" = "true" ]; then
  write_env ".env.local" "$DATABASE_URL_LOCAL" "0.0.0.0" "./api/storage" "./api/models" "$AUTH_SERVICE_URL_LOCAL" "# REDIS_URL=" "$ML_WORKERS"
  WRITTEN_FILES+=(".env.local")
fi

if [ "$WRITE_PROD" = "true" ]; then
  write_env ".env.prod"  "$DATABASE_URL_PROD"  "0.0.0.0" "/app/storage"  "/app/models" "$AUTH_SERVICE_URL_PROD"  "REDIS_URL=redis://redis:6379/0" "$ML_WORKERS"
  WRITTEN_FILES+=(".env.prod")
fi

if [ "$WRITE_COOLIFY" = "true" ]; then
  cat > .env.coolify <<ENVFILE
# Coolify production env — paste into Coolify UI or use as compose --env-file
# Domains (set these in Coolify; Traefik routes via Host rules)
DOMAIN_STUDIO=${DOMAIN_STUDIO}
DOMAIN_API=${DOMAIN_API}
DOMAIN_AUTH=${DOMAIN_AUTH}

# API
STORAGE_DIR=/app/storage
MODEL_DIR=/app/models
API_PORT=${API_PORT}
API_HOST=0.0.0.0
AUTH_SERVICE_URL=http://auth:${AUTH_PORT}

# Auth
AUTH_PORT=${AUTH_PORT}
JWT_SECRET=${JWT_SECRET}
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
INTERNAL_AUTH_SECRET=${INTERNAL_AUTH_SECRET}

# Database (PostgreSQL via docker-compose)
DATABASE_URL=postgresql+asyncpg://${DB_USER}:${DB_PASSWORD}@db:5432/${DB_NAME}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}
DB_NAME=${DB_NAME}
DB_PORT=5432
DB_DATA_DIR=/app/db-data

# Redis
REDIS_URL=redis://redis:6379/0

# ML Workers
ML_WORKERS=${ML_WORKERS}

# API Limits
MAX_UPLOAD_SIZE=52428800

# Studio
STUDIO_PORT=${STUDIO_PORT}
NEXT_PUBLIC_AUTH_URL=https://${DOMAIN_AUTH}
NEXT_PUBLIC_API_URL=https://${DOMAIN_API}

# CORS — derived from studio domain
CORS_ORIGINS=https://${DOMAIN_STUDIO}
ENVFILE
  WRITTEN_FILES+=(".env.coolify")
fi

# ── Summary ────────────────────────────────────────────────────────────────

echo "" >/dev/tty
printf "${GREEN}${BOLD}  Done! Wrote %s file(s):${RESET}\n" "${#WRITTEN_FILES[@]}" >/dev/tty
echo "" >/dev/tty
for f in "${WRITTEN_FILES[@]}"; do
  case "$f" in
    .env.local)   printf "  ${CYAN}%-14s${RESET}Local dev (SQLite, dynamic host)\n" "$f" >/dev/tty ;;
    .env.prod)    printf "  ${CYAN}%-14s${RESET}Production (PostgreSQL, Redis, Docker)\n" "$f" >/dev/tty ;;
    .env.coolify) printf "  ${CYAN}%-14s${RESET}Coolify deploy (paste into Coolify UI or use --env-file)\n" "$f" >/dev/tty ;;
  esac
done
echo "" >/dev/tty
printf "  ${DIM}Ports:  API=%s  Auth=%s  Studio=%s${RESET}\n" "$API_PORT" "$AUTH_PORT" "$STUDIO_PORT" >/dev/tty
printf "  ${DIM}Admin:  %s${RESET}\n" "$ADMIN_EMAIL" >/dev/tty
if [ "$WRITE_COOLIFY" = "true" ]; then
  printf "  ${DIM}Studio: https://%s${RESET}\n" "$DOMAIN_STUDIO" >/dev/tty
  printf "  ${DIM}API:    https://%s${RESET}\n" "$DOMAIN_API" >/dev/tty
  printf "  ${DIM}Auth:   https://%s${RESET}\n" "$DOMAIN_AUTH" >/dev/tty
fi
echo "" >/dev/tty

if [ "$WRITE_COOLIFY" = "true" ] && [ -n "$SSH_HOST" ]; then
  printf "  ${BOLD}Firewall (on %s):${RESET}\n" "$SSH_HOST" >/dev/tty
  printf "  ${DIM}  sudo ufw allow 80,443/tcp    # Traefik (HTTP redirect + HTTPS)${RESET}\n" >/dev/tty
  printf "  ${DIM}  Internal ports (%s, %s, %s) stay closed.${RESET}\n" "$API_PORT" "$AUTH_PORT" "$STUDIO_PORT" >/dev/tty
  echo "" >/dev/tty
fi

printf "  ${BOLD}Next steps:${RESET}\n" >/dev/tty
if [ "$WRITE_LOCAL" = "true" ]; then
  printf "  ${DIM}  make install && make dev-local    # local dev (SQLite)${RESET}\n" >/dev/tty
fi
if [ "$WRITE_PROD" = "true" ]; then
  printf "  ${DIM}  make dev-docker                   # docker compose (PostgreSQL)${RESET}\n" >/dev/tty
fi
if [ "$WRITE_COOLIFY" = "true" ]; then
  printf "  ${DIM}  Upload .env.coolify to Coolify (Project -> Environment Variables)${RESET}\n" >/dev/tty
  printf "  ${DIM}  Set compose files: docker-compose.yml + docker-compose.coolify.yml${RESET}\n" >/dev/tty
fi
echo "" >/dev/tty
