#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# QTS Messenger — Full Deployment Script
# (Synapse + client + auth-gateway + push-gateway, behind nginx)
# Run from the project root: bash scripts/setup.sh
# Requires: Docker, Docker Compose, openssl, curl
# ═══════════════════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
# SERVER_NAME is Synapse's server_name — baked into every Matrix ID
# (@user:SERVER_NAME) once accounts exist. On THIS production instance it's
# pinned to the old misspelled domain and must stay that way; a brand-new
# install can safely use the correctly spelled one.
SERVER_NAME="messanger.qts.dev"
SYNAPSE_DOMAIN="matrix.messanger.qts.dev"
# WEB_DOMAIN is where the client web app itself is served — independent of
# SERVER_NAME, so it can use the correct spelling even when SERVER_NAME can't.
WEB_DOMAIN="messenger.qts.dev"

cd "$PROJECT_DIR"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()    { echo -e "${GREEN}[✓]${NC} $1"; }
warn()    { echo -e "${YELLOW}[!]${NC} $1"; }
error()   { echo -e "${RED}[✗]${NC} $1"; exit 1; }
step()    { echo -e "\n${GREEN}═══ $1 ═══${NC}"; }

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  QTS Messenger — Deployment"
echo "  Web app     : $WEB_DOMAIN"
echo "  Server name : $SERVER_NAME"
echo "  Synapse API : $SYNAPSE_DOMAIN"
echo "═══════════════════════════════════════════════════════"


# ─────────────────────────────────────────────────────────────
# STEP 0 — Prerequisites
# ─────────────────────────────────────────────────────────────
step "Step 0: Checking prerequisites"

for cmd in docker openssl curl; do
    command -v "$cmd" &>/dev/null || error "$cmd is not installed."
    info "$cmd found"
done

# Detect docker compose (v2 plugin preferred over v1 standalone)
if docker compose version &>/dev/null 2>&1; then
    COMPOSE="docker compose"
elif command -v docker-compose &>/dev/null; then
    COMPOSE="docker-compose"
else
    error "docker compose is not installed."
fi
info "Using: $COMPOSE"


# ─────────────────────────────────────────────────────────────
# STEP 1 — Collect info & generate secrets
# ─────────────────────────────────────────────────────────────
step "Step 1: Configuration"

if [ -f .env ]; then
    warn ".env already exists — loading it (delete to regenerate)"
    source .env
else
    read -rp "Enter your email for Let's Encrypt certificates: " CERTBOT_EMAIL
    [ -z "$CERTBOT_EMAIL" ] && error "Email is required for Let's Encrypt."

    info "Generating random secrets..."
    POSTGRES_PASSWORD=$(openssl rand -hex 24)
    SYNAPSE_REGISTRATION_SHARED_SECRET=$(openssl rand -hex 32)
    SYNAPSE_MACAROON_SECRET_KEY=$(openssl rand -hex 32)
    SYNAPSE_FORM_SECRET=$(openssl rand -hex 32)

    cat > .env <<EOF
# Matrix Deployment Secrets — generated $(date)
# KEEP THIS FILE PRIVATE — never commit to git

SERVER_NAME=${SERVER_NAME}
SYNAPSE_DOMAIN=${SYNAPSE_DOMAIN}
WEB_DOMAIN=${WEB_DOMAIN}

POSTGRES_DB=synapse
POSTGRES_USER=synapse_user
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}

SYNAPSE_REGISTRATION_SHARED_SECRET=${SYNAPSE_REGISTRATION_SHARED_SECRET}
SYNAPSE_MACAROON_SECRET_KEY=${SYNAPSE_MACAROON_SECRET_KEY}
SYNAPSE_FORM_SECRET=${SYNAPSE_FORM_SECRET}

CERTBOT_EMAIL=${CERTBOT_EMAIL}
EOF
    info ".env created with generated secrets"
    source .env
fi

# WEB_DOMAIN may be missing on an existing .env from before the web app's
# domain was split out from SERVER_NAME — top it up rather than assuming
# it's there (this is what actually fixes the misspelled-domain issue).
# Checked against the file directly, not the shell var, since WEB_DOMAIN
# already has a script-level default above even when .env lacks the line.
if ! grep -q '^WEB_DOMAIN=' .env; then
    WEB_DOMAIN="messenger.qts.dev"
    info "Adding WEB_DOMAIN=${WEB_DOMAIN} to .env..."
    echo "WEB_DOMAIN=${WEB_DOMAIN}" >> .env
fi

# VAPID keys (Web Push) may be missing even on an existing .env from before
# this feature was added — top it up rather than assuming it's there.
if [ -z "${VAPID_PUBLIC_KEY:-}" ]; then
    info "Generating VAPID keys for Web Push..."
    docker build -q -t qts-push-gateway push-gateway/ > /tmp/qts-push-gateway-build.log \
        || error "Failed to build push-gateway image (log: /tmp/qts-push-gateway-build.log)"
    VAPID_OUT=$(docker run --rm qts-push-gateway node scripts/generate-vapid-keys.js)
    VAPID_PUBLIC_KEY=$(echo "$VAPID_OUT" | grep VAPID_PUBLIC_KEY | cut -d= -f2)
    VAPID_PRIVATE_KEY=$(echo "$VAPID_OUT" | grep VAPID_PRIVATE_KEY | cut -d= -f2)
    {
        echo ""
        echo "VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY}"
        echo "VAPID_PRIVATE_KEY=${VAPID_PRIVATE_KEY}"
        echo "VAPID_SUBJECT=mailto:${CERTBOT_EMAIL}"
    } >> .env
    info "VAPID keys generated and saved to .env"
fi


# ─────────────────────────────────────────────────────────────
# STEP 2 — Generate homeserver.yaml from template
# ─────────────────────────────────────────────────────────────
step "Step 2: Generating homeserver.yaml"

mkdir -p synapse/data

# Replace %%PLACEHOLDER%% tokens with real values from .env
# openssl hex output is safe for sed (no special chars)
sed \
    -e "s|%%POSTGRES_USER%%|${POSTGRES_USER}|g" \
    -e "s|%%POSTGRES_PASSWORD%%|${POSTGRES_PASSWORD}|g" \
    -e "s|%%POSTGRES_DB%%|${POSTGRES_DB}|g" \
    -e "s|%%REGISTRATION_SECRET%%|${SYNAPSE_REGISTRATION_SHARED_SECRET}|g" \
    -e "s|%%MACAROON_SECRET%%|${SYNAPSE_MACAROON_SECRET_KEY}|g" \
    -e "s|%%FORM_SECRET%%|${SYNAPSE_FORM_SECRET}|g" \
    synapse/homeserver.yaml.template > synapse/homeserver.yaml

info "synapse/homeserver.yaml created"


# ─────────────────────────────────────────────────────────────
# STEP 3 — Generate Synapse signing key & log config
# ─────────────────────────────────────────────────────────────
step "Step 3: Generating Synapse signing key"

if [ -f "synapse/data/${SERVER_NAME}.signing.key" ]; then
    warn "Signing key already exists — skipping generation"
else
    info "Running synapse generate (creates signing key + log config)..."
    docker run --rm \
        -v "$(pwd)/synapse/data:/data" \
        -e "SYNAPSE_SERVER_NAME=${SERVER_NAME}" \
        -e "SYNAPSE_REPORT_STATS=no" \
        matrixdotorg/synapse:latest generate

    # `generate` creates its own homeserver.yaml — replace with ours
    cp synapse/homeserver.yaml synapse/data/homeserver.yaml
    info "Signing key generated at synapse/data/${SERVER_NAME}.signing.key"
fi


# ─────────────────────────────────────────────────────────────
# STEP 4 — Create directory structure
# ─────────────────────────────────────────────────────────────
step "Step 4: Creating directories"

mkdir -p nginx/certbot/conf nginx/certbot/www synapse/data/media_store
info "Directories ready"


# ─────────────────────────────────────────────────────────────
# STEP 5 — Obtain SSL certificates
# ─────────────────────────────────────────────────────────────
step "Step 5: Obtaining SSL certificates"

CERT_PATH="nginx/certbot/conf/live/${SERVER_NAME}/fullchain.pem"
WEB_CERT_PATH="nginx/certbot/conf/live/${WEB_DOMAIN}/fullchain.pem"
NEED_TEMP_NGINX=false
[ -f "$CERT_PATH" ] || NEED_TEMP_NGINX=true
[ -f "$WEB_CERT_PATH" ] || NEED_TEMP_NGINX=true

if [ "$NEED_TEMP_NGINX" = true ]; then
    info "Starting temporary HTTP server for ACME challenge..."
    # Clean up a leftover container from a previous interrupted run —
    # otherwise `docker run --name matrix-nginx-init` below fails on
    # both name and port-80 conflicts.
    docker rm -f matrix-nginx-init &>/dev/null || true
    docker run -d \
        --name matrix-nginx-init \
        -p 80:80 \
        -v "$(pwd)/nginx/nginx-init.conf:/etc/nginx/nginx.conf:ro" \
        -v "$(pwd)/nginx/certbot/www:/var/www/certbot:ro" \
        nginx:alpine

    sleep 3
fi

if [ -f "$CERT_PATH" ]; then
    warn "SSL certificate for ${SERVER_NAME} already exists — skipping (delete nginx/certbot/conf to renew)"
else
    info "Requesting certificate for ${SERVER_NAME} and ${SYNAPSE_DOMAIN}..."
    # Single cert with both domains as SANs (stored under the first domain name)
    docker run --rm \
        -v "$(pwd)/nginx/certbot/conf:/etc/letsencrypt" \
        -v "$(pwd)/nginx/certbot/www:/var/www/certbot" \
        certbot/certbot certonly \
            --webroot \
            --webroot-path=/var/www/certbot \
            --email "${CERTBOT_EMAIL}" \
            --agree-tos \
            --no-eff-email \
            -d "${SERVER_NAME}" \
            -d "${SYNAPSE_DOMAIN}"

    info "SSL certificate for ${SERVER_NAME} obtained"
fi

if [ -f "$WEB_CERT_PATH" ]; then
    warn "SSL certificate for ${WEB_DOMAIN} already exists — skipping (delete nginx/certbot/conf to renew)"
else
    info "Requesting certificate for ${WEB_DOMAIN}..."
    # Requires DNS for WEB_DOMAIN to already point at this server.
    docker run --rm \
        -v "$(pwd)/nginx/certbot/conf:/etc/letsencrypt" \
        -v "$(pwd)/nginx/certbot/www:/var/www/certbot" \
        certbot/certbot certonly \
            --webroot \
            --webroot-path=/var/www/certbot \
            --email "${CERTBOT_EMAIL}" \
            --agree-tos \
            --no-eff-email \
            -d "${WEB_DOMAIN}"

    info "SSL certificate for ${WEB_DOMAIN} obtained"
fi

if [ "$NEED_TEMP_NGINX" = true ]; then
    info "Stopping temporary nginx..."
    docker stop matrix-nginx-init && docker rm matrix-nginx-init
fi


# ─────────────────────────────────────────────────────────────
# STEP 6 — Start all services
# ─────────────────────────────────────────────────────────────
step "Step 6: Building images & starting services"

# --build ensures the client image picks up VAPID/gateway URLs baked in
# as build args from the current .env (docker compose auto-loads it).
$COMPOSE --env-file .env up -d --build
info "All containers started"


# ─────────────────────────────────────────────────────────────
# STEP 7 — Verification
# ─────────────────────────────────────────────────────────────
step "Step 7: Verification"

echo "Waiting 15 seconds for Synapse to start..."
sleep 15

# Check Synapse health
echo -n "  Synapse API... "
for i in $(seq 1 10); do
    if curl -sf "https://${SYNAPSE_DOMAIN}/_matrix/client/versions" > /dev/null 2>&1; then
        echo -e "${GREEN}OK${NC}"
        break
    fi
    if [ "$i" -eq 10 ]; then
        echo -e "${YELLOW}not responding yet — check: docker logs matrix-synapse${NC}"
    fi
    sleep 3
done

# Check .well-known delegation
echo -n "  .well-known/matrix/server... "
WELLKNOWN=$(curl -sf "https://${SERVER_NAME}/.well-known/matrix/server" 2>/dev/null || echo "FAIL")
if echo "$WELLKNOWN" | grep -q "messanger.qts.dev"; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${YELLOW}${WELLKNOWN}${NC}"
fi

# Check the web client is reachable
echo -n "  Web client... "
if curl -sf "https://${WEB_DOMAIN}" > /dev/null 2>&1; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${YELLOW}not responding — check: docker logs matrix-client${NC}"
fi

# Check auth-gateway is reachable
echo -n "  Auth gateway... "
if curl -sf "https://${WEB_DOMAIN}/api/auth/health" > /dev/null 2>&1; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${YELLOW}not responding — check: docker logs matrix-auth-gateway${NC}"
fi

# Check push-gateway is reachable
echo -n "  Push gateway... "
if curl -sf "https://${WEB_DOMAIN}/api/push/health" > /dev/null 2>&1; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${YELLOW}not responding — check: docker logs matrix-push-gateway${NC}"
fi

# Check the old domain redirects to the new one
echo -n "  Old domain redirect... "
REDIRECT_TARGET=$(curl -s -o /dev/null -w '%{redirect_url}' "https://${SERVER_NAME}" 2>/dev/null || echo "")
if [[ "$REDIRECT_TARGET" == "https://${WEB_DOMAIN}"* ]]; then
    echo -e "${GREEN}OK${NC} (→ ${REDIRECT_TARGET})"
else
    echo -e "${YELLOW}unexpected: ${REDIRECT_TARGET}${NC}"
fi


# ─────────────────────────────────────────────────────────────
# DONE
# ─────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════"
echo -e "${GREEN}  DEPLOYMENT COMPLETE!${NC}"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  Web client  : https://${WEB_DOMAIN}"
echo "  Synapse API : https://${SYNAPSE_DOMAIN}"
echo ""
echo "  Next step: create your admin account:"
echo ""
echo "    bash scripts/create-admin.sh"
echo ""
echo "  View logs:  docker compose logs -f"
echo "  Stop all:   docker compose down"
echo "═══════════════════════════════════════════════════════"
