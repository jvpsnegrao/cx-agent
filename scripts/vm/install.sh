#!/usr/bin/env bash
# install.sh — provisiona cx-agent numa VM Ubuntu 24.04 LTS fresh.
# Roda como root (curl|bash). Idempotente.
#
# Uso:
#   echo "sk-ant-..." > /root/.anthropic-key
#   curl -fsSL https://raw.githubusercontent.com/jvpsnegrao/cx-agent/main/scripts/vm/install.sh | bash

set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; BLUE='\033[0;36m'; NC='\033[0m'
ok()    { echo -e "${GREEN}✓${NC} $1"; }
warn()  { echo -e "${YELLOW}⚠${NC} $1"; }
err()   { echo -e "${RED}✗${NC} $1"; }
step()  { echo -e "\n${BLUE}▸${NC} $1"; }
fatal() { err "$1"; exit 1; }

[ "$(id -u)" -eq 0 ] || fatal "Rode como root (sudo -i ou login direto)."

REPO_URL="${REPO_URL:-https://github.com/jvpsnegrao/cx-agent.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/khal}"
KHAL_USER="${KHAL_USER:-khal}"

# Helper pra rodar como khal user (sempre presente após passo 2)
as_khal() { runuser -u "$KHAL_USER" -- "$@"; }
# Usa runuser -l (login shell c/ PAM session) — PM2/omni precisam disso pra spawnar daemons.
as_khal_login() { runuser -l "$KHAL_USER" -c "$1"; }
as_postgres() { runuser -u postgres -- "$@"; }

step "1/12 — APT base"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  curl git tmux jq unzip ufw build-essential ca-certificates \
  postgresql postgresql-contrib \
  python3 python3-pip \
  locales \
  >/dev/null
locale-gen en_US.UTF-8 >/dev/null 2>&1 || true
ok "deps apt instaladas"

step "2/12 — Usuário khal"
if ! id "$KHAL_USER" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "$KHAL_USER"
  usermod -aG sudo "$KHAL_USER"
  echo "$KHAL_USER ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/khal
  ok "usuário $KHAL_USER criado"
else ok "usuário $KHAL_USER já existe"; fi

step "3/12 — Postgres (cluster local + DB omni)"
systemctl enable --now postgresql >/dev/null
if ! as_postgres psql -tA -c "SELECT 1 FROM pg_database WHERE datname='omni'" | grep -q 1; then
  as_postgres psql -c "ALTER USER postgres WITH PASSWORD 'postgres';" >/dev/null
  as_postgres psql -c "CREATE DATABASE omni;" >/dev/null
  as_postgres psql -d omni -c "ALTER DATABASE omni SET timezone TO 'UTC';" >/dev/null
  ok "DB omni criado em UTC"
else ok "DB omni já existe"; fi

PG_HBA=$(ls /etc/postgresql/*/main/pg_hba.conf | head -1)
if ! grep -q "host omni postgres 127.0.0.1/32 md5" "$PG_HBA"; then
  echo "host omni postgres 127.0.0.1/32 md5" >> "$PG_HBA"
  systemctl restart postgresql
  ok "pg_hba liberado pra localhost md5"
fi

step "4/12 — Bun + Node"
if ! as_khal_login 'command -v bun' >/dev/null 2>&1; then
  as_khal_login 'curl -fsSL https://bun.sh/install | bash >/dev/null'
  ok "bun instalado p/ $KHAL_USER"
else ok "bun já instalado"; fi

if ! as_khal_login 'command -v node' >/dev/null 2>&1; then
  as_khal_login '
    export NVM_DIR="$HOME/.nvm"
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash >/dev/null
    . "$NVM_DIR/nvm.sh"
    nvm install --lts >/dev/null
    nvm use --lts >/dev/null
  '
  ok "node LTS instalado via nvm"
else ok "node já instalado"; fi

# Symlinks globais pro node/npm — pm2 (e qualquer #!/usr/bin/env node) precisam
NODE_BIN=$(ls -d /home/$KHAL_USER/.nvm/versions/node/v*/bin 2>/dev/null | tail -1)
if [ -n "$NODE_BIN" ]; then
  ln -sf "$NODE_BIN/node" /usr/local/bin/node
  ln -sf "$NODE_BIN/npm"  /usr/local/bin/npm
  ln -sf "$NODE_BIN/npx"  /usr/local/bin/npx
  ok "node/npm/npx symlinked em /usr/local/bin"
fi

step "5/12 — cosign + pm2 (pré-reqs do autopg/omni)"
if ! command -v cosign >/dev/null; then
  curl -fsSL https://github.com/sigstore/cosign/releases/latest/download/cosign-linux-amd64 -o /usr/local/bin/cosign
  chmod +x /usr/local/bin/cosign
  ok "cosign instalado"
else ok "cosign já instalado"; fi

# pm2 global pro khal (autopg/omni precisam invocar)
as_khal_login 'export PATH="$HOME/.bun/bin:$PATH" && command -v pm2 >/dev/null || $HOME/.bun/bin/bun install -g pm2 >/dev/null'
ok "pm2 disponível"

step "5b/12 — Omni + Genie + autopg"
as_khal_login '
  export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"
  command -v omni   >/dev/null || curl -fsSL https://raw.githubusercontent.com/automagik-dev/omni/main/install.sh   | bash -s -- --server >/dev/null
  command -v genie  >/dev/null || curl -fsSL https://raw.githubusercontent.com/automagik-dev/genie/main/install.sh  | bash >/dev/null
  command -v autopg >/dev/null || curl -fsSL https://raw.githubusercontent.com/automagik-dev/autopg/main/install.sh | bash >/dev/null
'
ok "Omni/Genie/autopg instalados"

step "6/12 — Clone repo + bun install"
if [ ! -d "$INSTALL_DIR/.git" ]; then
  mkdir -p "$INSTALL_DIR"
  chown -R "$KHAL_USER:$KHAL_USER" "$INSTALL_DIR"
  as_khal git clone "$REPO_URL" "$INSTALL_DIR"
  ok "repo clonado em $INSTALL_DIR"
else
  as_khal git -C "$INSTALL_DIR" pull --ff-only
  ok "repo atualizado"
fi
as_khal_login "cd $INSTALL_DIR && \$HOME/.bun/bin/bun install >/dev/null"
ok "bun install"

step "7/12 — .env"
ENV_FILE="$INSTALL_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  as_khal cp "$INSTALL_DIR/.env.example" "$ENV_FILE"
  TOKEN=$(openssl rand -hex 32)
  as_khal sed -i "s/dev-token-change-me-in-prod/$TOKEN/" "$ENV_FILE"
  ok ".env criado (token gerado)"
else ok ".env já existe"; fi

# Injeta ANTHROPIC_API_KEY se disponível
ANTHROPIC_KEY="${ANTHROPIC_API_KEY:-$(cat /root/.anthropic-key 2>/dev/null || cat /home/$KHAL_USER/.anthropic-key 2>/dev/null || true)}"
if [ -n "$ANTHROPIC_KEY" ]; then
  # Remove qualquer comentário ANTHROPIC e adiciona a real
  as_khal sed -i '/^#.*ANTHROPIC_API_KEY=/d; /^ANTHROPIC_API_KEY=/d' "$ENV_FILE"
  echo "ANTHROPIC_API_KEY=$ANTHROPIC_KEY" >> "$ENV_FILE"
  chown "$KHAL_USER:$KHAL_USER" "$ENV_FILE"
  ok "ANTHROPIC_API_KEY injetada"
else
  warn "ANTHROPIC_API_KEY não encontrada — defina em /root/.anthropic-key e re-rode"
fi

step "8/12 — Migrate + seed schema khal.*"
as_khal_login "
  cd $INSTALL_DIR/packages/db
  export KHAL_DATABASE_URL='postgresql://postgres:postgres@localhost:5432/omni'
  \$HOME/.bun/bin/bun src/migrate.ts >/dev/null
  \$HOME/.bun/bin/bun src/seed.ts >/dev/null
"
ok "schema + seed aplicados"

step "9/12 — Omni up + WhatsApp instance"
as_khal_login 'export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH" && omni start >/dev/null 2>&1 || true && sleep 3'

INSTANCE_ID=$(as_khal_login '
  export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"
  omni instances list --json 2>/dev/null | jq -r ".[] | select(.channel==\"whatsapp-baileys\") | .id" | head -1
')
if [ -z "$INSTANCE_ID" ]; then
  as_khal_login '
    export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"
    omni instances create --name nova-onyx --channel whatsapp-baileys >/dev/null 2>&1 || true
  '
  INSTANCE_ID=$(as_khal_login '
    export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"
    omni instances list --json 2>/dev/null | jq -r ".[] | select(.channel==\"whatsapp-baileys\") | .id" | head -1
  ')
fi
ok "instance Omni: $INSTANCE_ID"

OMNI_KEY=$(as_khal_login 'jq -r ".apiKey // empty" ~/.omni/config.json 2>/dev/null || true')
if [ -n "$OMNI_KEY" ]; then
  as_khal sed -i "s|<your-omni-api-key>|$OMNI_KEY|" "$ENV_FILE"
  as_khal sed -i "s|<your-omni-instance-id>|$INSTANCE_ID|" "$ENV_FILE"
  ok "OMNI_API_KEY + INSTANCE_ID injetados no .env"
fi

as_khal_login "
  export PATH=\"\$HOME/.bun/bin:\$HOME/.local/bin:\$PATH\"
  cd $INSTALL_DIR
  [ -f .genie/workspace.json ] || timeout 8 genie init --no-interactive --no-tui >/dev/null 2>&1 || true
  genie agent register nova --dir ./agent-nova --no-interactive --no-tui --skip-omni >/dev/null 2>&1 || true
"
ok "Genie workspace + Nova registrado"

step "10/12 — PM2 ecosystem (cx-demo + genie-bridge)"
mkdir -p /var/log/khal
chown "$KHAL_USER:$KHAL_USER" /var/log/khal

as_khal_login "
  export PATH=\"\$HOME/.bun/bin:\$HOME/.local/bin:\$PATH\"
  cd $INSTALL_DIR
  pm2 delete cx-demo genie-bridge >/dev/null 2>&1 || true
  pm2 start scripts/vm/ecosystem.config.cjs >/dev/null
  pm2 save >/dev/null
"
# pm2 startup (systemd)
env "PATH=$PATH:/home/$KHAL_USER/.bun/bin" pm2 startup systemd -u "$KHAL_USER" --hp "/home/$KHAL_USER" >/dev/null 2>&1 || true
ok "PM2 ecosystem rodando + startup configurado"

step "11/12 — Caddy + nip.io HTTPS"
if ! command -v caddy >/dev/null; then
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
  ok "Caddy instalado"
else ok "Caddy já instalado"; fi

PUBLIC_IP=$(curl -s4 ifconfig.me || curl -s4 icanhazip.com)
NIP_DOMAIN="${PUBLIC_IP//./-}.nip.io"

cat > /etc/caddy/Caddyfile <<EOF
$NIP_DOMAIN {
  reverse_proxy localhost:3000
  encode gzip
}
EOF
systemctl restart caddy
ok "Caddy configurado: https://$NIP_DOMAIN → :3000"

step "12/12 — Firewall ufw"
ufw --force enable >/dev/null
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
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
echo "      runuser -u $KHAL_USER -- bash -lc 'export PATH=\$HOME/.bun/bin:\$PATH && omni instances connect $INSTANCE_ID && omni instances qr $INSTANCE_ID'"
echo
echo "   2. Verifique PM2:"
echo "      runuser -u $KHAL_USER -- pm2 status"
echo
echo "   3. Logs em caso de problema:"
echo "      runuser -u $KHAL_USER -- pm2 logs cx-demo --lines 50"
echo "      runuser -u $KHAL_USER -- pm2 logs genie-bridge --lines 50"
echo
