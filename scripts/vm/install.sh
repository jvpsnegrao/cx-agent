#!/usr/bin/env bash
# install.sh — provisiona Khal numa VM Ubuntu 24.04 LTS fresh.
# Idempotente: pode rodar várias vezes sem quebrar nada.
#
# Uso (na VM como root ou sudo):
#   curl -fsSL https://raw.githubusercontent.com/jvpsnegrao/cx-agent/main/scripts/vm/install.sh | bash
#
# Pré-requisitos do user antes de rodar:
#   1. VM Ubuntu 24.04 LTS (Hetzner CX22 testado, 2vCPU/4GB)
#   2. ANTHROPIC_API_KEY em $HOME/.anthropic-key (ou export)
#   3. Tem 5min livre p/ scanear QR do WhatsApp ao final

set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; BLUE='\033[0;36m'; NC='\033[0m'
ok()    { echo -e "${GREEN}✓${NC} $1"; }
warn()  { echo -e "${YELLOW}⚠${NC} $1"; }
err()   { echo -e "${RED}✗${NC} $1"; }
step()  { echo -e "\n${BLUE}▸${NC} $1"; }
fatal() { err "$1"; exit 1; }

[ "$(id -u)" -ne 0 ] && SUDO=sudo || SUDO=""

REPO_URL="${REPO_URL:-https://github.com/jvpsnegrao/cx-agent.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/khal}"
KHAL_USER="${KHAL_USER:-khal}"

step "1/12 — APT base"
$SUDO apt-get update -qq
$SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  curl git tmux jq unzip ufw build-essential ca-certificates \
  postgresql postgresql-contrib \
  python3 python3-pip \
  >/dev/null
ok "deps apt instaladas"

step "2/12 — Usuário khal"
if ! id "$KHAL_USER" >/dev/null 2>&1; then
  $SUDO useradd -m -s /bin/bash "$KHAL_USER"
  $SUDO usermod -aG sudo "$KHAL_USER"
  echo "$KHAL_USER ALL=(ALL) NOPASSWD:ALL" | $SUDO tee /etc/sudoers.d/khal >/dev/null
  ok "usuário $KHAL_USER criado"
else ok "usuário $KHAL_USER já existe"; fi

step "3/12 — Postgres (cluster local + DB omni)"
$SUDO systemctl enable --now postgresql >/dev/null
if ! $SUDO -u postgres psql -tA -c "SELECT 1 FROM pg_database WHERE datname='omni'" | grep -q 1; then
  $SUDO -u postgres psql -c "ALTER USER postgres WITH PASSWORD 'postgres';" >/dev/null
  $SUDO -u postgres psql -c "CREATE DATABASE omni;" >/dev/null
  $SUDO -u postgres psql -d omni -c "ALTER DATABASE omni SET timezone TO 'UTC';" >/dev/null
  ok "DB omni criado em UTC"
else ok "DB omni já existe"; fi

# Permite localhost com senha (pg_hba)
PG_HBA=$(ls /etc/postgresql/*/main/pg_hba.conf | head -1)
if ! grep -q "host omni postgres 127.0.0.1/32 md5" "$PG_HBA"; then
  echo "host omni postgres 127.0.0.1/32 md5" | $SUDO tee -a "$PG_HBA" >/dev/null
  $SUDO systemctl restart postgresql
  ok "pg_hba liberado pra localhost md5"
fi

step "4/12 — Bun + Node"
if ! sudo -u "$KHAL_USER" bash -c 'command -v bun' >/dev/null 2>&1; then
  $SUDO -u "$KHAL_USER" bash -c 'curl -fsSL https://bun.sh/install | bash' >/dev/null
  ok "bun instalado p/ $KHAL_USER"
else ok "bun já instalado"; fi

# Node via nvm (Genie/Omni precisam node no PATH)
if ! sudo -u "$KHAL_USER" bash -c 'command -v node' >/dev/null 2>&1; then
  $SUDO -u "$KHAL_USER" bash -c '
    export NVM_DIR="$HOME/.nvm"
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash >/dev/null
    . "$NVM_DIR/nvm.sh"
    nvm install --lts >/dev/null
    nvm use --lts >/dev/null
  '
  ok "node LTS instalado via nvm"
else ok "node já instalado"; fi

step "5/12 — Omni + Genie + autopg"
$SUDO -u "$KHAL_USER" bash -lc '
  export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"
  command -v omni   >/dev/null || curl -fsSL https://raw.githubusercontent.com/automagik-dev/omni/main/install.sh   | bash -s -- --server >/dev/null
  command -v autopg >/dev/null || curl -fsSL https://raw.githubusercontent.com/automagik-dev/autopg/main/install.sh | bash >/dev/null
  command -v genie  >/dev/null || curl -fsSL https://raw.githubusercontent.com/automagik-dev/genie/main/install.sh  | bash >/dev/null
'
ok "Omni/Genie/autopg instalados"

step "6/12 — Clone repo + bun install"
if [ ! -d "$INSTALL_DIR/.git" ]; then
  $SUDO mkdir -p "$INSTALL_DIR"
  $SUDO chown -R "$KHAL_USER:$KHAL_USER" "$INSTALL_DIR"
  $SUDO -u "$KHAL_USER" git clone "$REPO_URL" "$INSTALL_DIR"
  ok "repo clonado em $INSTALL_DIR"
else
  $SUDO -u "$KHAL_USER" git -C "$INSTALL_DIR" pull --ff-only
  ok "repo atualizado"
fi
$SUDO -u "$KHAL_USER" bash -lc "cd $INSTALL_DIR && \$HOME/.bun/bin/bun install >/dev/null"
ok "bun install"

step "7/12 — .env"
ENV_FILE="$INSTALL_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  $SUDO -u "$KHAL_USER" cp "$INSTALL_DIR/.env.example" "$ENV_FILE"
  TOKEN=$(openssl rand -hex 32)
  $SUDO -u "$KHAL_USER" sed -i "s/dev-token-change-me-in-prod/$TOKEN/" "$ENV_FILE"
  ok ".env criado (token gerado)"
else ok ".env já existe"; fi

# Injeta ANTHROPIC_API_KEY se disponível em /root/.anthropic-key ou env
ANTHROPIC_KEY="${ANTHROPIC_API_KEY:-$(cat /root/.anthropic-key 2>/dev/null || cat /home/$KHAL_USER/.anthropic-key 2>/dev/null || true)}"
if [ -n "$ANTHROPIC_KEY" ]; then
  if grep -q "^ANTHROPIC_API_KEY=" "$ENV_FILE"; then
    $SUDO -u "$KHAL_USER" sed -i "s|^ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=$ANTHROPIC_KEY|" "$ENV_FILE"
  else
    echo "ANTHROPIC_API_KEY=$ANTHROPIC_KEY" | $SUDO -u "$KHAL_USER" tee -a "$ENV_FILE" >/dev/null
  fi
  ok "ANTHROPIC_API_KEY injetada"
else
  warn "ANTHROPIC_API_KEY não encontrada — defina em /home/$KHAL_USER/.anthropic-key e re-rode"
fi

step "8/12 — Migrate + seed schema khal.*"
$SUDO -u "$KHAL_USER" bash -lc "
  cd $INSTALL_DIR/packages/db
  export KHAL_DATABASE_URL='postgresql://postgres:postgres@localhost:5432/omni'
  \$HOME/.bun/bin/bun src/migrate.ts >/dev/null
  \$HOME/.bun/bin/bun src/seed.ts >/dev/null
"
ok "schema + seed aplicados"

step "9/12 — Omni up + WhatsApp instance"
$SUDO -u "$KHAL_USER" bash -lc '
  export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"
  omni start >/dev/null 2>&1 || true
  sleep 2
'
INSTANCE_ID=$($SUDO -u "$KHAL_USER" bash -lc '
  export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"
  omni instances list --json 2>/dev/null | jq -r ".[] | select(.channel==\"whatsapp-baileys\") | .id" | head -1
')
if [ -z "$INSTANCE_ID" ]; then
  $SUDO -u "$KHAL_USER" bash -lc '
    export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"
    omni instances create --name nova-onyx --channel whatsapp-baileys >/dev/null 2>&1 || true
  '
  INSTANCE_ID=$($SUDO -u "$KHAL_USER" bash -lc '
    export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"
    omni instances list --json 2>/dev/null | jq -r ".[] | select(.channel==\"whatsapp-baileys\") | .id" | head -1
  ')
fi
ok "instance Omni: $INSTANCE_ID"

# Injeta OMNI_API_KEY + INSTANCE_ID no .env
OMNI_KEY=$($SUDO -u "$KHAL_USER" bash -lc 'jq -r ".apiKey // empty" ~/.omni/config.json 2>/dev/null || true')
if [ -n "$OMNI_KEY" ]; then
  $SUDO -u "$KHAL_USER" sed -i "s|<your-omni-api-key>|$OMNI_KEY|" "$ENV_FILE"
  $SUDO -u "$KHAL_USER" sed -i "s|<your-omni-instance-id>|$INSTANCE_ID|" "$ENV_FILE"
  ok "OMNI_API_KEY + INSTANCE_ID injetados no .env"
fi

# Workspace Genie + register Nova
$SUDO -u "$KHAL_USER" bash -lc "
  export PATH=\"\$HOME/.bun/bin:\$HOME/.local/bin:\$PATH\"
  cd $INSTALL_DIR
  [ -f .genie/workspace.json ] || timeout 8 genie init --no-interactive --no-tui >/dev/null 2>&1 || true
  genie agent register nova --dir ./agent-nova --no-interactive --no-tui --skip-omni >/dev/null 2>&1 || true
"
ok "Genie workspace + Nova registrado"

step "10/12 — PM2 + ecosystem"
$SUDO -u "$KHAL_USER" bash -lc 'export PATH="$HOME/.bun/bin:$PATH" && command -v pm2 >/dev/null || $HOME/.bun/bin/bun install -g pm2 >/dev/null'
ok "pm2 disponível"
$SUDO -u "$KHAL_USER" bash -lc "
  export PATH=\"\$HOME/.bun/bin:\$HOME/.local/bin:\$PATH\"
  cd $INSTALL_DIR
  pm2 delete all >/dev/null 2>&1 || true
  pm2 start scripts/vm/ecosystem.config.cjs >/dev/null
  pm2 save >/dev/null
"
# pm2 startup como root (sobreviver reboot)
$SUDO env "PATH=$PATH:/home/$KHAL_USER/.bun/bin" pm2 startup systemd -u "$KHAL_USER" --hp "/home/$KHAL_USER" >/dev/null 2>&1 || true
ok "PM2 ecosystem rodando + startup configurado"

step "11/12 — Caddy + nip.io HTTPS"
if ! command -v caddy >/dev/null; then
  $SUDO apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | $SUDO gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | $SUDO tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  $SUDO apt-get update -qq
  $SUDO apt-get install -y -qq caddy >/dev/null
  ok "Caddy instalado"
else ok "Caddy já instalado"; fi

# Descobre IP público da VM
PUBLIC_IP=$(curl -s4 ifconfig.me || curl -s4 icanhazip.com)
NIP_DOMAIN="${PUBLIC_IP//./-}.nip.io"

cat > /tmp/Caddyfile <<EOF
$NIP_DOMAIN {
  reverse_proxy localhost:3000
  encode gzip
}
EOF
$SUDO mv /tmp/Caddyfile /etc/caddy/Caddyfile
$SUDO systemctl restart caddy
ok "Caddy configurado: https://$NIP_DOMAIN → :3000"

step "12/12 — Firewall ufw"
$SUDO ufw --force enable >/dev/null
$SUDO ufw allow 22/tcp >/dev/null
$SUDO ufw allow 80/tcp >/dev/null
$SUDO ufw allow 443/tcp >/dev/null
ok "ufw: 22, 80, 443 abertos"

echo
echo "════════════════════════════════════════════════════════════════"
echo " ✓ Provisionamento concluído"
echo "════════════════════════════════════════════════════════════════"
echo
echo " URL pública: https://$NIP_DOMAIN"
echo " Senha demo:  onyx-demo"
echo
echo " Próximos passos manuais:"
echo "   1. SSH na VM e scaneie o QR do WhatsApp:"
echo "      sudo -u $KHAL_USER bash -lc 'export PATH=\$HOME/.bun/bin:\$PATH && omni instances connect $INSTANCE_ID && omni instances qr $INSTANCE_ID'"
echo
echo "   2. Verifique PM2:"
echo "      sudo -u $KHAL_USER pm2 status"
echo
echo "   3. Logs em caso de problema:"
echo "      sudo -u $KHAL_USER pm2 logs cx-demo --lines 50"
echo "      sudo -u $KHAL_USER pm2 logs genie-bridge --lines 50"
echo
