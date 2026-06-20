#!/bin/bash
set -e

OMNI_URL="${OMNI_API_URL:-http://omni:8882}"
OMNI_KEY="${OMNI_API_KEY:?missing OMNI_API_KEY}"
NATS_URL="${GENIE_NATS_URL:-omni:4222}"

# 1. autopg (Genie state DB) — needs to be installed before genie serve
if ! autopg status >/dev/null 2>&1; then
  echo "[entrypoint] installing autopg..."
  autopg install --port 5434 --no-pm2 2>&1 || true
  # Start autopg as background daemon
  nohup autopg postmaster --port 5434 > /tmp/autopg.log 2>&1 &
  sleep 3
fi

# 2. Wait for Omni
echo "[entrypoint] waiting for omni at $OMNI_URL..."
until curl -sf "$OMNI_URL/api/v2/health" >/dev/null 2>&1; do
  echo "[entrypoint] omni not ready, waiting..."
  sleep 2
done
echo "[entrypoint] omni up"

# 3. Configure omni CLI
mkdir -p /root/.omni
cat > /root/.omni/config.json <<EOF
{
  "apiUrl": "$OMNI_URL",
  "format": "human",
  "apiKey": "$OMNI_KEY"
}
EOF

# 4. Genie config
mkdir -p /root/.genie
cat > /root/.genie/config.json <<EOF
{
  "version": 2,
  "setupComplete": true,
  "promptMode": "append",
  "brain": { "embedded": true },
  "workspaceRoot": "/workspace",
  "omni": {
    "apiUrl": "$OMNI_URL",
    "apiKey": "$OMNI_KEY",
    "executor": "tmux"
  }
}
EOF

# 5. Init workspace
cd /workspace
if [ ! -f /workspace/.genie/workspace.json ]; then
  mkdir -p /workspace/.genie
  cat > /workspace/.genie/workspace.json <<EOF
{
  "name": "khal",
  "agents": { "defaults": {} },
  "tmux": { "socket": "genie" },
  "sdk": {}
}
EOF
fi

# 6. Register Nova
genie agent register nova --dir /workspace/agent-nova --no-interactive --no-tui --skip-omni 2>&1 || true

# 7. Configure omni instance + connect if first run
INSTANCE_ID="${OMNI_INSTANCE_ID:-}"
if [ -z "$INSTANCE_ID" ]; then
  # Try to find or create
  EXISTING=$(omni instances list --json 2>/dev/null | jq -r '.[] | select(.channel=="whatsapp-baileys") | .id' | head -1)
  if [ -z "$EXISTING" ]; then
    echo "[entrypoint] creating WhatsApp instance..."
    omni instances create --name nova-onyx --channel whatsapp-baileys 2>&1
    EXISTING=$(omni instances list --json 2>/dev/null | jq -r '.[] | select(.channel=="whatsapp-baileys") | .id' | head -1)
  fi
  INSTANCE_ID=$EXISTING
fi
echo "[entrypoint] INSTANCE_ID=$INSTANCE_ID"

# 8. Connect agent to instance (idempotent)
omni connect "$INSTANCE_ID" nova 2>&1 || true

# 9. Set provider to turn-based
PROVIDER_ID=$(omni providers list --json 2>/dev/null | jq -r '.[] | select(.schema=="nats-genie") | .id' | head -1)
if [ -n "$PROVIDER_ID" ]; then
  omni providers update "$PROVIDER_ID" --schema-config "{\"natsUrl\":\"$NATS_URL\",\"agentDir\":\"/workspace/agent-nova\",\"agentName\":\"nova\",\"mode\":\"turn-based\"}" 2>&1 || true
fi

# 10. Init khal_* schema + seed
if [ -n "$KHAL_DATABASE_URL" ]; then
  echo "[entrypoint] migrating khal schema..."
  bun /workspace/packages/db/src/migrate.ts 2>&1 || true
  bun /workspace/packages/db/src/seed.ts 2>&1 || true
fi

# 11. Print QR for WhatsApp scan
if [ "$(omni instances status $INSTANCE_ID 2>/dev/null | grep state | awk '{print $2}')" != "connected" ]; then
  echo ""
  echo "════════════════════════════════════════════"
  echo "  SCAN WHATSAPP QR (run from host):"
  echo "    docker exec -it khal-bridge omni instances qr $INSTANCE_ID"
  echo "  or follow logs to see auto-printed QR:"
  echo "    docker logs -f khal-bridge"
  echo "════════════════════════════════════════════"
  echo ""
  omni instances connect $INSTANCE_ID 2>&1 || true
  sleep 3
  omni instances qr $INSTANCE_ID --no-watch 2>&1 || true
fi

# 12. Genie serve (the bridge)
export GENIE_NATS_URL=$NATS_URL
echo "[entrypoint] starting genie serve..."
exec genie serve start --headless
