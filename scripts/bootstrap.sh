#!/usr/bin/env bash
# bootstrap.sh — Setup reproduzível em macOS/Linux limpo.
# Roda os installs externos, prepara DB e registra Nova.
# Não cuida do QR (interativo) nem do `omni connect` (depende de instance ID).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*" >&2; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }

# 1. Bun
if ! command -v bun >/dev/null 2>&1; then
  log "instalando bun"
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi
log "bun $(bun --version)"

# 2. Omni server (sobe Postgres+NATS+API via PM2 — non-interactive)
if ! command -v omni >/dev/null 2>&1; then
  log "instalando omni server"
  bash "$REPO_ROOT/vendor/omni/install.sh" --server
fi
log "omni $(omni --version)"

# 3. autopg (Postgres dedicado pro Genie)
if ! command -v autopg >/dev/null 2>&1; then
  log "instalando autopg"
  curl -fsSL https://raw.githubusercontent.com/automagik-dev/autopg/main/install.sh | bash
fi
if ! autopg status >/dev/null 2>&1; then
  log "registrando autopg-server em 5434 (5432 pode conflitar com Docker Desktop)"
  autopg install --port 5434
fi

# 4. Genie
if ! command -v genie >/dev/null 2>&1; then
  log "instalando genie"
  bash "$REPO_ROOT/vendor/genie/install.sh"
fi
log "genie $(genie --version)"

# 5. Genie setup (--quick = sem prompts)
genie setup --quick --no-interactive --no-tui >/dev/null 2>&1 || warn "genie setup --quick falhou; provavelmente já feito"

# 6. Workspace + agent Nova
cd "$REPO_ROOT"
if [ ! -f .genie/workspace.json ]; then
  log "criando workspace .genie/ (genie init pode levar ~10s, busy-loop conhecido)"
  ( genie init --no-interactive --no-tui & ) >/dev/null 2>&1
  sleep 12
  pkill -f "genie init" >/dev/null 2>&1 || true
fi

if [ ! -d agent-nova ] || [ ! -f agent-nova/AGENTS.md ]; then
  warn "agent-nova/AGENTS.md não existe — abortando"
  exit 1
fi

if ! genie agent directory 2>&1 | grep -q "^nova "; then
  log "registrando agent Nova"
  genie agent register nova --dir ./agent-nova --no-interactive --no-tui --skip-omni
fi

# 7. Deps + DB
log "instalando workspace deps"
bun install --quiet

log "rodando migrate + seed"
export KHAL_DATABASE_URL="${KHAL_DATABASE_URL:-postgresql://postgres:postgres@localhost:8432/omni}"
bun packages/db/src/migrate.ts
bun packages/db/src/seed.ts

cat <<EOF

═══════════════════════════════════════════════════════════
Bootstrap completo. Próximos passos manuais:
  1. Cria instância WhatsApp:
       omni instances create --name nova-onyx --channel whatsapp-baileys
  2. Pega o INSTANCE_ID e roda:
       omni instances connect <INSTANCE_ID>
       omni instances qr <INSTANCE_ID>
     (scaneia no WhatsApp do número da Nova)
  3. Liga Omni ↔ Nova:
       omni connect <INSTANCE_ID> nova
  4. Manda "oi" do teu WhatsApp pro número.
═══════════════════════════════════════════════════════════
EOF
