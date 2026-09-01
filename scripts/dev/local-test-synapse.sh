#!/bin/bash
# Disposable local Matrix Synapse for manual UI verification during development.
# Never touches production. Data lives in .local-test-synapse/ (gitignored).
set -e
# MSYS_NO_PATHCONV is set per-command (not exported) below, only for the
# `docker run -v ...` calls — exporting it globally also breaks curl's
# `-o /dev/null` under Git-Bash-on-Windows's native curl.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_DIR="$SCRIPT_DIR/.local-test-synapse"
DATA_DIR="$TEST_DIR/data"
CONTAINER=qts-test-synapse
IMAGE=matrixdotorg/synapse:latest
PORT=8008

cmd="${1:-start}"

case "$cmd" in
  start)
    mkdir -p "$DATA_DIR"
    if [ ! -f "$DATA_DIR/homeserver.yaml" ]; then
      echo "Generating local Synapse config..."
      MSYS_NO_PATHCONV=1 docker run --rm -v "$DATA_DIR:/data" \
        -e SYNAPSE_SERVER_NAME=localhost \
        -e SYNAPSE_REPORT_STATS=no \
        "$IMAGE" generate
      echo >> "$DATA_DIR/homeserver.yaml"   # generated file has no trailing newline
      cat >> "$DATA_DIR/homeserver.yaml" <<'YAML'
enable_registration: true
enable_registration_without_verification: true
user_directory:
  search_all_users: true
YAML
    fi
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    MSYS_NO_PATHCONV=1 docker run -d --name "$CONTAINER" -p "$PORT:8008" -v "$DATA_DIR:/data" "$IMAGE" >/dev/null
    echo "Waiting for Synapse to be ready..."
    for i in $(seq 1 60); do
      if curl -s -o /dev/null "http://localhost:$PORT/_matrix/client/versions"; then
        echo "Synapse ready at http://localhost:$PORT"
        exit 0
      fi
      sleep 1
    done
    echo "Synapse did not become ready in time" >&2
    exit 1
    ;;
  stop)
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    echo "Stopped."
    ;;
  reset)
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    rm -rf "$DATA_DIR"
    echo "Data wiped. Run 'start' again for a fresh server."
    ;;
  seed)
    for u in tester1 tester2; do
      curl -s -X POST "http://localhost:$PORT/_matrix/client/v3/register" \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"$u\",\"password\":\"TestPass123!\",\"auth\":{\"type\":\"m.login.dummy\"}}"
      echo
    done
    ;;
  *)
    echo "Usage: $0 {start|stop|reset|seed}" >&2
    exit 1
    ;;
esac
