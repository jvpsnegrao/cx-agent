# Khal — Agente de CX no WhatsApp

> Teste técnico para **KHAL** / Namastex. Agente conversacional WhatsApp construído com **Genie** (orquestrador Claude Code) + **Omni** (bridge Baileys), encarnando **"Nova"** — assistente virtual da operadora fictícia **"Onyx Telecom"**.

## Status

**End-to-end validado**: WhatsApp → Omni → NATS → Genie bridge → Claude Code → MCP cx-tools → Postgres/Linear/Slack → `omni say` → WhatsApp. A Nova responde com a persona da Onyx Telecom em PT-BR. Veja [Gotchas conhecidos](#gotchas-conhecidos) pros 2-3 prompts manuais que aparecem na 1ª spawn do Claude (limitação atual do Genie spawn flow, documentada com workaround).

`brew install tmux` é hard requirement (a bridge spawn falha silenciosa sem ele).

## O que o agente faz

Nova atende clientes da Onyx no WhatsApp:

- **Consulta plano, status, consumo e fatura** (`consultar_conta`)
- **Gera 2ª via de fatura** (`segunda_via_fatura`)
- **Abre chamado técnico no Linear**, com confirmação 2-passos (`abrir_ticket`)
- **Escala pra atendente humano via Slack**, com resumo + sentiment (`escalar_atendente`)
- **É proativa**: cron dispara lembrete de fatura 3 dias antes do vencimento (`packages/cx-cron`)

## Arquitetura

```
WhatsApp → Omni channel-whatsapp (Baileys, PM2)
       → NATS JetStream (omni.message.<inst>.*)
       → genie serve daemon (bridge automática)
       → spawn `claude` em agent-nova/ com --resume <session>
       → Claude lê AGENTS.md + .mcp.json
       → MCP server "cx-tools" (4 tools) → Postgres + Linear + Slack
       → resposta via `omni say` → NATS → WhatsApp
```

**Camadas:**
- `agent-nova/` — Definição da Nova (AGENTS.md persona + .mcp.json wiring)
- `packages/db/` — Schema Drizzle (`khal_*`) + seed
- `packages/cx-tools/` — MCP server Bun com 4 tools (domain pura + adapters Linear/Slack)
- `packages/cx-cron/` — Worker proativo

## Setup

**Pré-requisitos:** macOS ou Linux, ≥4GB RAM livre, conta Linear + Slack incoming webhook.

```bash
# 1. Bun
curl -fsSL https://bun.sh/install | bash

# 2. Omni (sobe Postgres + NATS + API via PM2 — ~2min)
curl -fsSL https://raw.githubusercontent.com/automagik-dev/omni/main/install.sh | bash -s -- --server

# 3. Genie + autopg (Postgres dedicado pro state do Genie)
curl -fsSL https://raw.githubusercontent.com/automagik-dev/genie/main/install.sh | bash
curl -fsSL https://raw.githubusercontent.com/automagik-dev/autopg/main/install.sh | bash
autopg install --port 5434
genie setup --quick

# 4. Clone + deps
git clone <este-repo> khal && cd khal
cp .env.example .env  # preencha LINEAR_API_KEY, SLACK_WEBHOOK_URL
bun install

# 5. Workspace + agent Nova
genie init --no-interactive --no-tui
genie agent register nova --dir ./agent-nova

# 6. Schema + seed
export KHAL_DATABASE_URL="postgresql://postgres:postgres@localhost:8432/omni"
bun packages/db/src/migrate.ts
bun packages/db/src/seed.ts

# 7. WhatsApp
omni instances create --name nova-onyx --channel whatsapp-baileys
INSTANCE_ID=$(omni instances list --json | jq -r '.[] | select(.name=="nova-onyx") | .id')
omni instances connect $INSTANCE_ID
omni instances qr $INSTANCE_ID  # scaneia no Zap

# 8. Liga Omni ↔ Nova
omni connect $INSTANCE_ID nova
```

Mande "oi" do seu WhatsApp pro número da Nova — ela responde.

## Tools

| Tool | Tipo | I/O | Confirmação |
|---|---|---|---|
| `consultar_conta` | read | Postgres | — |
| `segunda_via_fatura` | write soft | Postgres + URL | 1/2 |
| `abrir_ticket` | write hard | Linear + Postgres | 1/2/3 (proposta → confirmar) |
| `escalar_atendente` | handoff | Slack + Postgres | — (cliente pediu) |

## Demonstração end-to-end

1. `omni instances qr $INSTANCE_ID` → scaneia
2. Manda "qual minha fatura?" do número `+5511999990001` (seedado como João Silva) → Nova responde com plano + fatura
3. Manda "minha internet caiu" → Nova propõe ticket → você responde "1" → Linear cria
4. Manda "quero falar com gente" → Nova escala → Slack recebe resumo + sentiment
5. `OMNI_INSTANCE_ID=$INSTANCE_ID bun packages/cx-cron/src/reminder.ts` → cliente com fatura vencendo em 3d recebe msg proativa

## Testes

```bash
bun test
# 4 unit tests verdes — domínio puro (formatCustomerSummary, renderSlackBlocks)
```

Meta de cobertura: ~70% em `src/tools/` + `src/domain/`. Sem perseguir % em glue/wiring (ports/adapters explicitamente fora).

## Decisões arquiteturais

Ver [docs/decisions/](docs/decisions/). Resumo:

- **ADR 001** — Piggyback no `omni-pgserve` em vez de Postgres próprio (schema `khal_*`)
- **ADR 002** — Confirmação 2-passos em write actions via lista numerada WhatsApp
- **ADR 003** — Bun em vez de Node (alinhamento com Omni+Genie, que são Bun-only)
- **ADR 004** — Persistir tudo (msgs+sentiment) em vez de só confiar em Claude `--resume`

## Anti-escopo (não foi feito de propósito)

- Multi-tenant (agente single-empresa Onyx Telecom)
- Voz/áudio (só texto)
- Dashboard de métricas
- Integração real com SAP/billing (mock no Postgres é suficiente pro teste)
- Autenticação do cliente (número WhatsApp = chave única)
- 90%+ cobertura — meta é qualidade nas tools, não % no wiring
- Playwright e2e

## Gotchas conhecidos

### Setup
- `genie init --no-interactive` tem busy-loop bug (99% CPU). Workaround: rodar uma vez, deixar criar `.genie/workspace.json`, matar processo. Não bloqueia subsequentes.
- Migração inicial precisa de `CREATE SCHEMA IF NOT EXISTS` (drizzle-kit gera sem `IF NOT EXISTS`, patchado manual em `0000_*.sql`).
- Porta 5432 pode conflitar com Docker Desktop — autopg foi instalado em 5434.
- `tmux` precisa estar instalado E em `/opt/homebrew/bin/tmux` (ou /usr/local/bin) — o Genie spawn vai por `/bin/sh`. Sem tmux a bridge dropa msgs silenciosamente.

### Bootstrap manual da 1ª conexão WhatsApp ↔ Nova
A wiring é feita pelo `omni connect` mas tem 1 ajuste pós-execução:

```bash
# 1. Após omni connect, atualizar provider pra modo turn-based (default é fire-and-forget):
omni providers update <provider-id> --schema-config '{"natsUrl":"localhost:4222","agentDir":"./agent-nova","agentName":"nova","mode":"turn-based"}'

# 2. Adicionar OMNI_API_KEY ao genie config (~/.genie/config.json):
{ ..., "omni": { "apiUrl": "http://localhost:8882", "apiKey": "omni_sk_..." } }

# 3. Genie serve precisa de OMNI_API_KEY no env quando inicia
OMNI_API_KEY="..." OMNI_API_URL="..." genie serve start --headless
```

### UX da 1ª msg (cold start)
Na **primeira** mensagem que chega da Nova, o Claude Code spawnado pela bridge pode mostrar dois prompts interactivos no tmux pane que precisam ser respondidos uma vez:

1. **Workspace trust** — "Is this a project you trust? 1. Yes, I trust this folder"
2. **Auto mode** — "Enable auto mode? 2. Yes, enable auto mode"

A bridge não responde esses prompts automaticamente (limitação atual do Genie). Workaround para o avaliador:

```bash
# Anexar ao tmux pane da Nova:
tmux -L genie attach -t nova
# Responder 1 + Enter (trust), depois 2 + Enter (auto mode)
# Detach: Ctrl-B D
```

Após responder uma vez por sessão, próximas msgs respondem direto. **Não é bloqueador do core funcional** — provamos end-to-end que Nova responde via `omni say` quando Claude spawn completa.

### MCP server cx-tools auth
A Claude Code mostra `1 MCP server needs auth · /mcp` na 1ª spawn. Workaround manual:
```bash
tmux -L genie attach -t nova
# Digite: /mcp
# Selecione cx-tools → Allow
```

Polish de UX (auto-trust, auto-auth, spawn cwd correto) requer fork/PR no Genie e fica como next steps documentado.
