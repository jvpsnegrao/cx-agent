# ADR 005 — Substituir Linear+Slack por cx-demo (mini-backend próprio + painel live)

**Data:** 2026-06-20 · **Status:** accepted · **Supersedes:** integração Linear/Slack (ADR 002 e wiring original)

## Contexto

Versão inicial da Nova abria tickets no **Linear** (`abrir_ticket`) e escalava handoffs no **Slack** (`escalar_atendente`). Ambas integrações eram reais — atendiam ao requisito do teste técnico ("≥1 tool externa real") — mas tinham 3 problemas observados ao validar a demo:

1. **Setup do avaliador era pesado**: criar conta Linear, gerar API key, criar workspace, criar canal Slack, gerar webhook. Cada um desses tem fricção, e nada disso é o "produto" — é apenas plumbing.
2. **Avaliador via o resultado em outro lugar**: o ticket abria no Linear, o handoff caía no Slack. Avaliador alternava entre 3 telas (WhatsApp, Linear, Slack) sem sensação de "produto coeso".
3. **Sem live feedback**: o avaliador não enxergava a Nova *no ato* de chamar a tool. Latência do Linear/Slack + abrir aba era ruim como demo.

## Decisão

Trocar Linear+Slack por um **mini-backend próprio** (`apps/cx-demo/`) que:

- Expõe **API REST** (`POST /api/v1/tickets`, `POST /api/v1/handoffs`, `PATCH …`) chamada pelo MCP server `cx-tools` via HTTP. Autenticação Bearer com `CX_DEMO_TOKEN`.
- Renderiza um **painel web** (Hono + JSX SSR + HTMX, ver ADR 006) com tabs: Tickets, Handoffs, Conversas, Faturas, Clientes.
- Empurra **eventos em tempo real via SSE** (ver ADR 007) — quando Nova abre um ticket, ele aparece no painel em ≤2s.

Tudo num único processo Bun, mesma porta (`:3000` por padrão).

## Por quê

- **Setup zero pro avaliador**: `bun run demo` sobe a stack. Não precisa criar conta em nada.
- **Demo coesa**: avaliador abre 1 URL (`localhost:3000`), manda msg no WhatsApp, vê tudo refletido em tempo real. Bate a sensação de "produto".
- **Demonstra fluência de arquitetura**: HTTP + Postgres + NATS + SSE com Bun-only stack — mesma stack da casa (Omni).
- **Mantém isolamento adapter↔domain**: o `domain/ticket.ts` e `domain/handoff.ts` continuam intactos; só a implementação concreta do `LinearAdapter`/`SlackAdapter` mudou (agora ambas são satisfied pelo mesmo `createCxDemoAdapter`). Inversão de dependência preservada.

## Tradeoffs

- **Não é mais "integração externa real"**: o `cx-demo` é nosso. Mitigamos demonstrando que o adapter é HTTP — trocar pra Linear/Slack/Zendesk de novo é uma linha (`createXAdapter` no `server.ts`).
- **Mais código no repo**: `apps/cx-demo/` adiciona ~20 arquivos. Compensa pelos 3 problemas resolvidos.
- **Coluna `tickets.linearId` virou nome enganoso** — agora guarda o identifier interno do cx-demo (ex.: `ONYX-12`). Rename pra `external_id` fica como TODO.

## Alternativas descartadas

- **Manter Linear+Slack**: resolve o requisito mas perde a demo coesa.
- **Repo separado pro backend+painel**: mais limpo conceitualmente mas dobra setup (clone 2 repos).
- **Painel só read-only sem cx-demo backend**: avaliador veria tickets/handoffs, mas não viria a Nova abrindo eles (sem persistência owned).

Ver ADR 006 (stack do painel) e ADR 007 (realtime).
