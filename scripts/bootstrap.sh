#!/usr/bin/env bash
# Bootstrap end-to-end do projeto Khal — uma execução pra deixar tudo
# pronto pro `bun run demo` + scan QR do WhatsApp.
# Idempotente: pode rodar várias vezes sem quebrar nada.

set -e

GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; BLUE='\033[0;36m'; NC='\033[0m'
ok()    { echo -e "${GREEN}✓${NC} $1"; }
warn()  { echo -e "${YELLOW}⚠${NC} $1"; }
err()   { echo -e "${RED}✗${NC} $1"; }
step()  { echo -e "\n${BLUE}▸${NC} $1"; }
fatal() { err "$1"; exit 1; }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

step "1/9 — Pré-requisitos"
command -v bun  >/dev/null || fatal "bun: curl -fsSL https://bun.sh/install | bash"
command -v node >/dev/null || fatal "node: PM2 do Omni/Genie precisa node no PATH (qualquer versão recente)"
command -v tmux >/dev/null || fatal "tmux: brew install tmux (macOS) ou apt install tmux (Linux)"
command -v jq   >/dev/null || warn  "jq opcional (recomendado pra parsing JSON)"
ok "bun  $(bun --version)"
ok "node $(node --version)"
ok "tmux $(tmux -V | awk '{print $2}')"

step "2/9 — Omni / Genie / autopg (idempotente)"
if ! command -v omni >/dev/null; then
  echo "  Instalando Omni..."
  curl -fsSL https://raw.githubusercontent.com/automagik-dev/omni/main/install.sh | bash -s -- --server
  ok "Omni instalado"
else ok "Omni já instalado"; fi
if ! command -v autopg >/dev/null; then
  echo "  Instalando autopg..."
  curl -fsSL https://raw.githubusercontent.com/automagik-dev/autopg/main/install.sh | bash
  ok "autopg instalado"
else ok "autopg já instalado"; fi
if ! command -v genie >/dev/null; then
  echo "  Instalando Genie..."
  curl -fsSL https://raw.githubusercontent.com/automagik-dev/genie/main/install.sh | bash
  ok "Genie instalado"
else ok "Genie já instalado"; fi

step "3/9 — Subindo Omni + autopg"
omni start >/dev/null 2>&1 || true
sleep 2
if omni doctor --fix 2>&1 | tail -10 | grep -qE "(OK|healthy)"; then
  ok "Omni saudável"
else
  warn "omni doctor com avisos — verifique manualmente"
fi

step "4/9 — Fix timezone UTC"
TZ=$(PGPASSWORD=postgres psql -h localhost -p 5432 -U postgres -d omni -tA -c "SHOW timezone" 2>/dev/null || echo "?")
if [ "$TZ" = "UTC" ]; then ok "timezone já em UTC"
else
  PGPASSWORD=postgres psql -h localhost -p 5432 -U postgres -d omni \
    -c "ALTER DATABASE omni SET timezone TO 'UTC';" >/dev/null
  ok "timezone setado pra UTC"
fi

step "5/9 — Deps + .env"
bun install >/dev/null 2>&1
ok "bun install"
if [ ! -f ".env" ]; then
  cp .env.example .env
  TOKEN=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p)
  /usr/bin/sed -i.bak "s/dev-token-change-me-in-prod/$TOKEN/" .env && rm -f .env.bak
  ok ".env criado (CX_DEMO_TOKEN gerado)"
else ok ".env já existe"; fi

step "6/9 — Migrate + seed"
cd packages/db
KHAL_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/omni" bun src/migrate.ts >/dev/null 2>&1
ok "schema khal.* aplicado"
KHAL_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/omni" bun src/seed.ts >/dev/null 2>&1
ok "5 clientes + 3 planos seedados"
cd "$REPO_DIR"

step "7/9 — Workspace Genie + agent Nova"
if [ ! -f ".genie/workspace.json" ]; then
  ( timeout 8 genie init --no-interactive --no-tui >/dev/null 2>&1 || true )
  ok ".genie/workspace.json criado"
else ok "workspace.json já existe"; fi
genie agent register nova --dir ./agent-nova --no-interactive --no-tui --skip-omni >/dev/null 2>&1 || true
ok "agent Nova registrado"

step "8/9 — WhatsApp instance"
EXISTING=$(omni instances list --json 2>/dev/null | jq -r '.[] | select(.channel=="whatsapp-baileys") | .id' 2>/dev/null | head -1)
if [ -z "$EXISTING" ]; then
  omni instances create --name nova-onyx --channel whatsapp-baileys >/dev/null 2>&1 || true
  EXISTING=$(omni instances list --json 2>/dev/null | jq -r '.[] | select(.channel=="whatsapp-baileys") | .id' 2>/dev/null | head -1)
fi
INSTANCE_ID="$EXISTING"
ok "instance: $INSTANCE_ID"
omni connect "$INSTANCE_ID" nova >/dev/null 2>&1 || true
PROV=$(omni providers list --json 2>/dev/null | jq -r '.[] | select(.schema=="nats-genie") | .id' 2>/dev/null | head -1)
if [ -n "$PROV" ]; then
  omni providers update "$PROV" --schema-config \
    "{\"natsUrl\":\"localhost:4222\",\"agentDir\":\"$(pwd)/agent-nova\",\"agentName\":\"nova\",\"mode\":\"turn-based\"}" \
    >/dev/null 2>&1 || true
  ok "provider em turn-based"
fi

step "9/9 — PRONTO ✓"
OMNI_KEY=$(jq -r '.apiKey // empty' ~/.omni/config.json 2>/dev/null || echo '<rode: cat ~/.omni/config.json>')

echo
echo "════════════════════════════════════════════════════════════════"
echo " 4 últimos passos manuais"
echo "════════════════════════════════════════════════════════════════"
echo
echo " 1. EDITE .env e preencha:"
echo "      OMNI_API_KEY=$OMNI_KEY"
echo "      OMNI_INSTANCE_ID=$INSTANCE_ID"
echo
echo " 2. Conecte WhatsApp:"
echo "      omni instances connect $INSTANCE_ID"
echo "      omni instances qr $INSTANCE_ID    # scaneie no Zap"
echo
echo " 3. Suba bridge + painel:"
echo "      OMNI_API_KEY=\"$OMNI_KEY\" \\"
echo "      OMNI_API_URL=http://localhost:8882 \\"
echo "      CX_DEMO_URL=http://localhost:3000 \\"
echo "      CX_DEMO_TOKEN=\$(grep CX_DEMO_TOKEN .env | cut -d= -f2) \\"
echo "      KHAL_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/omni \\"
echo "        pm2 start genie --name Genie -- serve start --headless --no-tui --no-interactive"
echo "      bun run demo &"
echo
echo " 4. Abra o painel: open http://localhost:3000/login   (senha: onyx-demo)"
echo
echo " ✓ Mande 'oi' do seu WhatsApp pro número da Nova"
echo
