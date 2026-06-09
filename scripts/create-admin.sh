#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Create a Matrix admin user
# Run after setup.sh: bash scripts/create-admin.sh
# ═══════════════════════════════════════════════════════════════

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

[ -f .env ] || { echo "ERROR: .env not found. Run setup.sh first."; exit 1; }
source .env

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Create Matrix Admin User"
echo "  Server: $SERVER_NAME"
echo "═══════════════════════════════════════════════════════"
echo ""

read -rp "Username (without @, e.g. admin): " USERNAME
[ -z "$USERNAME" ] && { echo "ERROR: Username cannot be empty."; exit 1; }

echo ""
echo "Creating admin user @${USERNAME}:${SERVER_NAME} ..."
echo "(You will be prompted for a password)"
echo ""

docker exec -it matrix-synapse \
    register_new_matrix_user \
    -c /data/homeserver.yaml \
    --admin \
    -u "$USERNAME" \
    http://localhost:8008

echo ""
echo "Admin user @${USERNAME}:${SERVER_NAME} created."
echo "Log in at: https://${CINNY_DOMAIN}"
