// PM2 ecosystem para deploy VM — controla 3 processos do Khal.
// Postgres e Omni são externos (postgres via systemd; omni-api/omni-nats já
// sobem via `omni start` que registra seus próprios PM2 entries com nomes
// `omni-api`, `omni-nats`). Este arquivo cuida só do que é nosso:
//
//   1. genie-bridge — orquestrador Claude Code (Genie) consumindo NATS
//   2. cx-demo      — painel Hono+JSX+HTMX+SSE (porta 3000)
//
// Pré-condições antes do pm2 start (resolvidas no install.sh):
//   - /opt/khal é o repo
//   - .env populado com ANTHROPIC_API_KEY, OMNI_API_KEY, OMNI_INSTANCE_ID, etc
//   - `omni start` rodou (omni-api + omni-nats já em PM2)
//   - `genie agent register nova` rodou

const path = require('path');
const fs = require('fs');

const REPO = path.resolve(__dirname, '../..');

// Mini .env parser (evita dep externa)
const ENV_FILE = path.join(REPO, '.env');
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const v = m[2].replace(/^['"]|['"]$/g, '');
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
const HOME = process.env.HOME || '/home/khal';
const BUN = `${HOME}/.bun/bin/bun`;

// PATH precisa ter ~/.local/bin pra autopg, ~/.bun/bin pra bun
const PATH_PREFIX = `${HOME}/.local/bin:${HOME}/.bun/bin:/usr/local/bin:/usr/bin:/bin`;

const sharedEnv = {
  PATH: PATH_PREFIX,
  HOME,
  NODE_ENV: 'production',
  KHAL_DATABASE_URL: process.env.KHAL_DATABASE_URL,
  OMNI_API_URL: process.env.OMNI_API_URL || 'http://localhost:8882',
  OMNI_API_KEY: process.env.OMNI_API_KEY,
  OMNI_INSTANCE_ID: process.env.OMNI_INSTANCE_ID,
  CX_DEMO_URL: process.env.CX_DEMO_URL || 'http://localhost:3000',
  CX_DEMO_TOKEN: process.env.CX_DEMO_TOKEN,
  CX_DEMO_PASSWORD: process.env.CX_DEMO_PASSWORD || 'onyx-demo',
  // SEM ANTHROPIC_API_KEY — usa OAuth login do Claude Code (sub do user).
  // API key cai em Tier 0 (10k tokens/min) e estoura 429 na primeira request.
  NATS_URL: process.env.NATS_URL || 'nats://localhost:4222',
  GENIE_NATS_URL: 'localhost:4222',
  GENIE_EXECUTOR: 'tmux',
};

module.exports = {
  apps: [
    {
      name: 'cx-demo',
      cwd: REPO,
      script: `${REPO}/apps/cx-demo/src/server.ts`,
      interpreter: BUN,
      env: sharedEnv,
      max_memory_restart: '500M',
      autorestart: true,
      out_file: '/var/log/khal/cx-demo.out.log',
      error_file: '/var/log/khal/cx-demo.err.log',
      merge_logs: true,
      time: true,
    },
    {
      name: 'genie-bridge',
      cwd: `${REPO}/agent-nova`,
      // Genie global (binary compilado em ~/.genie/bin/genie)
      script: `${HOME}/.genie/bin/genie`,
      args: 'serve start --headless --no-tui --no-interactive',
      env: sharedEnv,
      max_memory_restart: '1G',
      autorestart: true,
      out_file: '/var/log/khal/genie-bridge.out.log',
      error_file: '/var/log/khal/genie-bridge.err.log',
      merge_logs: true,
      time: true,
    },
  ],
};
