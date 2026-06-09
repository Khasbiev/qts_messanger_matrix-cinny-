#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Matrix Synapse + Cinny — Full Deployment Script
# Run from the project root: bash scripts/setup.sh
# Requires: Docker, Docker Compose, openssl, curl
# ═══════════════════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SERVER_NAME="messanger.qts.dev"
SYNAPSE_DOMAIN="matrix.messanger.qts.dev"

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
echo "  Matrix Synapse + Cinny — Deployment"
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
CINNY_DOMAIN=${SERVER_NAME}

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

if [ -f "$CERT_PATH" ]; then
    warn "SSL certificates already exist — skipping (delete nginx/certbot/conf to renew)"
else
    info "Starting temporary HTTP server for ACME challenge..."
    docker run -d \
        --name matrix-nginx-init \
        -p 80:80 \
        -v "$(pwd)/nginx/nginx-init.conf:/etc/nginx/nginx.conf:ro" \
        -v "$(pwd)/nginx/certbot/www:/var/www/certbot:ro" \
        nginx:alpine

    sleep 3

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

    info "Stopping temporary nginx..."
    docker stop matrix-nginx-init && docker rm matrix-nginx-init

    info "SSL certificates obtained"
fi


# ─────────────────────────────────────────────────────────────
# STEP 6 — Start all services
# ─────────────────────────────────────────────────────────────
step "Step 6: Starting services"

$COMPOSE --env-file .env up -d
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

# Check Cinny is reachable
echo -n "  Cinny web client... "
if curl -sf "https://${SERVER_NAME}" > /dev/null 2>&1; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${YELLOW}not responding — check: docker logs matrix-cinny${NC}"
fi


# ─────────────────────────────────────────────────────────────
# DONE
# ─────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════"
echo -e "${GREEN}  DEPLOYMENT COMPLETE!${NC}"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  Web client  : https://${SERVER_NAME}"
echo "  Synapse API : https://${SYNAPSE_DOMAIN}"
echo ""
echo "  Next step: create your admin account:"
echo ""
echo "    bash scripts/create-admin.sh"
echo ""
echo "  View logs:  docker compose logs -f"
echo "  Stop all:   docker compose down"
echo "═══════════════════════════════════════════════════════"
