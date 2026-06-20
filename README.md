# cx-agent — Agente de CX no WhatsApp

> Projetinho de estudo: agente conversacional no WhatsApp ("Nova" de uma operadora fictícia chamada Onyx Telecom) construído sobre **Genie** (orquestrador de Claude Code) + **Omni** (bridge Baileys), com painel web em tempo real.

**📱 WhatsApp da Nova:** `+55 34 95328-3194` &nbsp; · &nbsp; **🖥️ Painel:** _TBD (URL pública em breve)_ · senha `onyx-demo`

---

## TL;DR

A Nova atende clientes da Onyx Telecom no WhatsApp. Manda qualquer msg pra ela. Se você **não está cadastrado** ela conduz o cadastro completo (nome → plano → CEP+número validados via ViaCEP) e abre o ticket de instalação. Se você **já é cliente**, ela consulta sua conta, gera 2ª via como PDF anexo, abre chamados, escala pra humano.

Tudo que acontece no WhatsApp aparece em **tempo real no painel** via SSE. Dá pra assumir uma conversa pelo painel e responder como humano.

### Cenários sugeridos pra testar (5 minutos)

| O que mandar | Resultado esperado |
|---|---|
| `"oi"` | Nova cumprimenta e oferece ajuda; aparece no painel `/conversas` |
| `"qual minha mensalidade?"` (se for número conhecido — Pro 50GB R$ 89,90) | Nova chama `consultar_conta` e responde |
| `"quero a 2ª via"` | Nova envia **PDF anexo** demonstrativo (não link) |
| `"meu modem reiniciou 3 vezes hoje, abre um chamado"` | Nova propõe `ONYX-N` → confirme com `1` → ticket pisca no painel `/tickets` em ≤2s |
| `"quero falar com gente"` | Nova escala pra humano → conversa fica destacada na sidebar de `/conversas` com badge 🚨 |
| Pelo painel: abrir a conversa em handoff → clicar "Assumir" → digitar resposta → Enter | Você fala direto com o cliente como atendente |
| Manda do **seu número** que não está cadastrado: `"queria assinar"` | Nova guia onboarding: nome → 3 planos numerados → CEP → número → opcional complemento → cria você + abre ticket de instalação + gera primeira fatura |
| Digite mensagens com tom raivoso ("isso é absurdo, cancela tudo") | Badge sentiment vira 😟 frustrado / 🚨 urgente no painel automaticamente |

### O que ver no painel

| Tab | O que tem |
|---|---|
| **Tickets** | Chamados `ONYX-N` abertos pela Nova. Busca por id/título/cliente. Filtros por status. Timeline humanizada do ciclo de vida (aberto, status alterado, atualização enviada, escalado). Botão "Adicionar atualização" notifica o cliente no WhatsApp |
| **Conversas** | Threads agrupadas por cliente. Handoffs ativos destacados no topo. Clicando: feed cinza/cyan estilo WhatsApp. Sentiment badge atualiza automaticamente baseado nas últimas msgs |
| **Clientes** | CRUD completo. Busca. Detail expandido com plano + endereço validado via ViaCEP + faturas inline + tickets recentes. Form com máscaras BR (telefone, CEP, valor R$) |

---

## Arquitetura

```
WhatsApp
  → Omni channel-whatsapp (Baileys, PM2)        publica omni.message.<inst>.*
  → NATS JetStream
  → Genie serve daemon (bridge automática)
  → spawn `claude` em agent-nova/ com --resume <session>
  → Claude lê AGENTS.md + .mcp.json
  → MCP server "cx-tools" — 8 tools:
       ├─ consultar_conta / consultar_faturas / consultar_tickets  → khal.*
       ├─ segunda_via_fatura  → PDF inline + Omni /send/media
       ├─ abrir_ticket / escalar_atendente  → cx-demo HTTP
       └─ listar_planos / criar_cliente  → khal.* + ViaCEP + cx-demo
  → resposta via `omni say` → Postgres public.messages → WhatsApp

Painel cx-demo (Hono + JSX + HTMX + SSE):
  ← lê khal.* (nossos dados) + public.messages (Omni — fonte da verdade msgs)
  ← NATS subscriber pega incoming msgs em real-time
  ← Omni poll (2s) pega outgoing (Nova → cliente — Omni não publica isso no NATS)
  ← REST POST/PATCH/DELETE dispara SSE direto (zero round-trip)
```

**Camadas:**
- `agent-nova/` — Persona Nova (`AGENTS.md`) + `.mcp.json`
- `packages/db/` — Schema Drizzle (`khal.*`) + migrations + seed
- `packages/cx-tools/` — MCP server Bun (8 tools, ports & adapters)
- `packages/cx-cron/` — Worker proativo (lembrete de fatura T-3d)
- `apps/cx-demo/` — Backend HTTP + painel live demo

### Integrações externas reais

| Categoria | Onde |
|---|---|
| **DB Postgres** | 3 tools (`consultar_conta`, `consultar_faturas`, `consultar_tickets`) leem schema khal.* |
| **HTTP API** | 4 tools chamam `cx-demo` REST (`abrir_ticket`, `escalar_atendente`, `criar_cliente`, `segunda_via_fatura` indireto via PDF send) |
| **MCP server** | `cx-tools` é um servidor MCP completo (`@modelcontextprotocol/sdk` 1.0.4) |
| **API externa pública** | ViaCEP (`viacep.com.br`) — validação real de endereço no onboarding |
| **Omni REST** | `/api/v2/messages/send` (texto) + `/send/media` (PDF anexo) |

---

## O que faz o agente (8 tools MCP)

| Tool | Tipo | Quando a Nova chama |
|---|---|---|
| `consultar_conta(phone)` | read DB | "qual meu plano", "minha conta", "como tá meu cadastro" |
| `consultar_faturas(phone)` | read DB | "minhas faturas", "minhas cobranças", "o que devo" |
| `consultar_tickets(phone)` | read DB | "meus chamados", "previsão do meu ticket" |
| `segunda_via_fatura(phone)` | write soft + media | "manda a 2ª via" → gera PDF inline + envia como anexo WhatsApp |
| `abrir_ticket(phone, titulo, categoria, prioridade, descricao)` | write hard | "abre um chamado" → confirma com `1/2/3` → POST cx-demo → ticket aparece no painel |
| `escalar_atendente(phone, resumo, sentiment)` | handoff | "quero falar com gente" — Nova classifica sentiment automaticamente |
| `listar_planos()` | read DB | onboarding: apresenta os 3 planos com lista numerada |
| `criar_cliente(phone, nome, planoId, cep, numero, complemento?)` | write completo | onboarding: cadastra + abre ticket instalação + gera 1ª fatura (+10 dias) |

### Catálogo de planos da Onyx

| Plano | Mensalidade | Franquia |
|---|---|---|
| Light 20GB | R$ 59,90 | 20 GB |
| Pro 50GB | R$ 89,90 | 50 GB |
| Premium 100GB | R$ 129,90 | 100 GB |

### Jornada de cadastro (cliente novo)

```
Cliente: "queria assinar a Onyx"
Nova:    "Não te encontrei aqui. Quer fazer um cadastro novo?"
Cliente: "sim"
Nova:    "Qual seu nome?"
Cliente: "Maria"
Nova:    "Maria, temos 3 planos:
         1. Light 20GB — R$ 59,90/mês
         2. Pro 50GB — R$ 89,90/mês
         3. Premium 100GB — R$ 129,90/mês"
Cliente: "2"
Nova:    "Pro 50GB. Me passa seu CEP?"
Cliente: "01310-100"
Nova:    "Número da casa?"  (CEP foi validado via ViaCEP, ela já sabe que é Av. Paulista)
Cliente: "1000"
Nova:    "Tem complemento?"
Cliente: "não"
Nova:    [chama criar_cliente — insere customer + abre ONYX-N + gera fatura +10d]
         "Pronto Maria! Cadastrada no Pro 50GB. Abri o ONYX-12 pra equipe técnica
          agendar instalação — 24h alguém te procura. Primeira fatura R$ 89,90,
          vencimento dd/mm."
```

---

## Decisões arquiteturais

8 ADRs em [`docs/decisions/`](docs/decisions/):

- **001** — Piggyback no Postgres do Omni (schema `khal.*`, não DB próprio)
- **002** — Confirmação 2-passos em write actions via lista numerada WhatsApp
- **003** — Bun em vez de Node (alinhamento Omni/Genie)
- **004** — Persistir tudo (msgs + sentiment) em vez de confiar só em `--resume` do Claude
- **005** — Backend próprio `cx-demo` em vez de SaaS externos (UX coesa: 1 URL pra ver tudo)
- **006** — Painel em Hono + JSX SSR + HTMX (sem React, sem build step)
- **007** — Realtime via SSE + NATS subscriber + Omni poll (incoming NATS, outgoing poll)
- **008** — Jornada de cadastro de novo cliente via WhatsApp (3 planos + ViaCEP + ticket auto + cobrança +10d)

---

## Cobertura de testes

**175 tests** (139 unit/integration + 36 cx-tools), 0 falhas. Rode com:

```bash
cd packages/cx-tools && bun test tests/
cd apps/cx-demo && bun test tests/
```

Cobre:
- **Domain das tools** (8 cenários incluindo customer desconhecido, falha de adapter sem lixo no DB)
- **Sentiment heurístico** (39 + 28 corner cases — cliente surtado, ofensas, urgência financeira, mudança súbita "obrigado" após raiva, número solo `1/2/3`, emoji puro)
- **Onboarding** (15 — CEP malformado, ViaCEP timeout, duplicate phone, plano inexistente, complemento, fallback)
- **resolvePhone BR flex** (com/sem o "9" do celular)
- **API REST** (4 — auth Bearer, 400 sem campos, idempotency check Fix #8 do dedupe de tickets)
- **Auth painel** (18 — HMAC roundtrip, tampering, expiry, prefixo Bearer obrigatório)
- **Notify** (8 — mock fetch sem rede; rota texto vs media; erro 4xx/5xx/rede)
- **PDF gen** (3 — bytes válidos, acentos PT-BR, valor zero)

---

## Setup local (caso queira rodar)

**Pré-requisitos:** macOS ou Linux, ≥4GB RAM livre, `bun`, `node` (PM2 do Omni/Genie depende), `tmux`. `jq` recomendado.

### Setup rápido (1 comando)

```bash
git clone https://github.com/jvpsnegrao/cx-agent khal && cd khal
bun run setup        # roda scripts/bootstrap.sh — idempotente
```

O script faz tudo: instala Omni/Genie/autopg → aplica fix TZ Postgres → `.env` com `CX_DEMO_TOKEN` gerado → migra schema + seed (5 clientes + 3 planos) → registra Nova → cria WhatsApp instance. No final, mostra os 4 últimos passos manuais (preencher OMNI keys, scan QR, subir bridge+painel, abrir browser).

### Setup manual (passo a passo)

Veja [`docs/setup-manual.md`](docs/setup-manual.md) ou rode `bun run setup` que cobre o mesmo. Resumo dos passos:

1. Bun, Node, tmux instalados
2. `curl ...omni/install.sh | bash -s -- --server` (+ Genie + autopg)
3. `omni doctor --fix` + fix TZ UTC
4. `cp .env.example .env` + edita `CX_DEMO_TOKEN`, `OMNI_API_KEY`, `OMNI_INSTANCE_ID`
5. `bun install` + `cd packages/db && bun src/migrate.ts && bun src/seed.ts`
6. `genie init --no-interactive` (busy-loop bug: mata após 8s)
7. `genie agent register nova --dir ./agent-nova`
8. `omni instances create --channel whatsapp-baileys` + scan QR
9. `omni connect $INSTANCE_ID nova` + `omni providers update` (turn-based mode)
10. `bun run demo` + `pm2 start genie ...`

Acesse `http://localhost:3000/login` (senha: `onyx-demo`).

---

## Deploy em VM (Hetzner CX22 + nip.io)

Pra deixar tudo público pra avaliação, monta numa VM Ubuntu 24.04 (~€5/mês).

**Pré-requisitos:**

1. VM Hetzner CX22 ou equivalente (2 vCPU, 4GB RAM, Ubuntu 24.04 LTS)
2. `ANTHROPIC_API_KEY` da [console.anthropic.com](https://console.anthropic.com/settings/keys) — recomendo gerar com cap mensal (~$10–20 cobrem demo tranquilo)
3. Domínio? Não precisa — script usa `<ip-hifenizado>.nip.io` com HTTPS Let's Encrypt automático via Caddy

**Provisionamento (1 comando na VM):**

```bash
# Como root na VM:
echo "sk-ant-..." > /root/.anthropic-key
curl -fsSL https://raw.githubusercontent.com/jvpsnegrao/cx-agent/main/scripts/vm/install.sh | bash
```

O script cuida de tudo:

1. APT base (postgres, tmux, jq, ufw, build-essential)
2. Usuário `khal` dedicado
3. Postgres local + DB `omni` em UTC
4. Bun, Node (LTS via nvm), Omni, Genie, autopg
5. Clone repo + `bun install`
6. `.env` com token gerado, `ANTHROPIC_API_KEY` injetada
7. Migrate + seed (3 planos + 5 clientes)
8. `omni start` + cria instance `whatsapp-baileys`
9. `genie agent register nova`
10. PM2 com `ecosystem.config.cjs` (cx-demo + genie-bridge)
11. Caddy + HTTPS automático em `<ip>.nip.io`
12. Firewall ufw (22/80/443)

**Pós-deploy (manual, ~5min):**

```bash
# SSH na VM, scaneia o QR do WhatsApp no app do celular:
sudo -u khal bash -lc 'export PATH=$HOME/.bun/bin:$PATH && omni instances qr <INSTANCE_ID>'

# Confirma PM2 saudável:
sudo -u khal pm2 status

# Logs em caso de problema:
sudo -u khal pm2 logs cx-demo --lines 50
sudo -u khal pm2 logs genie-bridge --lines 50
```

**URL pública:** `https://<ip-hifenizado>.nip.io` · senha `onyx-demo`

> ⚠️ Re-scan do WhatsApp na VM desconecta a sessão Baileys local. Faça o scan na VM **depois** que o setup terminar.

---

## Gotchas conhecidos (honestos)

### Setup
- **Node como pré-req implícito**: PM2 usado pelos installers tem shebang `#!/usr/bin/env node`. README acima já lista.
- **Fix TZ obrigatório**: `ALTER DATABASE omni SET timezone TO 'UTC'`. Sem isso, multi-turn quebra em ~10s na primeira iteração do poll (turn-monitor vê last_activity_at com 3h de drift e mata a sessão).
- **Migrate cwd-relativo**: rode `bun src/migrate.ts` **de dentro de** `packages/db/`. Bug do drizzle-orm migrator que usa cwd.
- **`genie init` tem busy-loop bug** (99% CPU). Workaround: rode uma vez, deixa criar `.genie/workspace.json`, mate após 8s.

### Bridge / runtime
- **1ª spawn pede 3 prompts no tmux**: `workspace trust` + `auto mode` + `/mcp Allow`. Workaround: `tmux -L genie attach -t nova` e responde manualmente uma vez. Documentado como TODO pra polish futuro do Genie.
- **Cold start ~19s** no 1º turno por sessão Claude. Depois fica rápido.
- **Session expira em ~4min sem msg** → respawn = perde contexto. Bug upstream do Genie bridge.
- **"Digitando…" intermitente no WhatsApp**: cada `omni say` da Nova dispara `presence: composing → paused` no Baileys plugin com pausa proporcional ao tamanho do texto. Múltiplas msgs em sequência durante 1 turno causam o flap. Documentado como limitação Baileys, anti-escopo pra essa entrega.
- **Outgoing da Nova NÃO publica em NATS** (só incoming faz). Tratamos com poll de 2s em `public.messages` (ADR 007).

---

## Status & próximas etapas

✅ End-to-end validado: WhatsApp → Nova → painel atualiza em ≤2s  
✅ Onboarding completo de novo cliente via WhatsApp (Nova guia: nome → plano → CEP → número → cria + ticket + 1ª fatura)  
✅ PDF de boleto anexo via Omni `/send/media`  
✅ Sentiment automático ponderado nas últimas 5 msgs  
✅ 175 tests verdes  
✅ Cobertura de corner cases (cliente surtado, CEP timeout, duplicate phone, etc)  
⏳ Deploy hospedado (próxima iteração — VM com tudo)

---

## Licença / contato

Repositório: https://github.com/jvpsnegrao/cx-agent  
Candidato: João Vitor — `jvpsousa2@gmail.com`
