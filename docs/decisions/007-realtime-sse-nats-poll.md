# ADR 007 — Realtime no painel: SSE + NATS subscriber + Omni poll híbrido

**Data:** 2026-06-20 · **Status:** accepted

## Contexto

O painel `apps/cx-demo/` precisa refletir em tempo real (≤2s) tudo que acontece:

1. **Cliente manda msg pelo WhatsApp** → Conversas tab deve mostrar.
2. **Nova responde via `omni say`** → Conversas tab deve mostrar a resposta.
3. **Nova abre ticket** (chama `POST /api/v1/tickets`) → Tickets tab deve atualizar.
4. **Nova escala handoff** (chama `POST /api/v1/handoffs`) → Handoffs tab deve atualizar.

Investigando o que o Omni publica no NATS observamos:

- ✅ Msgs **incoming** (cliente → Nova) viram `omni.message.<inst>.<chat>` no NATS.
- ❌ Msgs **outgoing** (Nova → cliente via `omni say`) **NÃO** publicam em NATS. Omni grava direto em `public.messages` (sua própria tabela) e dispara HTTP.

## Decisão

Stack de realtime em **3 camadas combinadas**:

1. **NATS subscriber** (`apps/cx-demo/src/nats.ts`) — subscribe `omni.>` (wildcard), classifica por subject prefix, emite SSE `message_in` quando cliente manda msg.
2. **Omni poll** (`apps/cx-demo/src/omni-poll.ts`) — `setInterval(2000)` que consulta `public.messages WHERE created_at > lastSeen`, emite SSE `message_out` (e `message_in` como fallback). Cobre o gap das outgoing.
3. **In-app event bus** (`apps/cx-demo/src/events.ts`) — `EventEmitter` in-memory. Endpoints REST do próprio cx-demo (`POST /api/v1/tickets`, ações HTMX `/actions/handoffs/:id/claim`) emitem direto no bus (`ticket_created`, `handoff_opened`, etc.) sem precisar de polling externo.

Painel se inscreve em **um único endpoint SSE** (`GET /events`, autenticado por cookie). O endpoint serializa eventos do bus pro browser como `event: <type>` + `data: <json>`. HTMX SSE extension dispara `hx-trigger="sse:<type> from:body"` que faz `hx-get="/partials/..."` swap.

## Por quê

- **NATS wildcard** captura subjects que ainda não enumeramos (Omni versions mudam — novos topics tipo `omni.event.message.sent.*` aparecem; logamos os desconhecidos como "subject ignorado: …").
- **Poll de 2s** sobre `public.messages` é simples e cobre tanto o gap das outgoing quanto serve de fallback se NATS cair. Custo ~3 queries/seg em um Postgres local: irrelevante.
- **In-app bus** evita round-trip NATS pros próprios eventos do cx-demo (`POST /api/v1/tickets` emite direto no bus que já está conectado ao SSE — latência ~zero).
- **SSE > WebSocket** pra esse caso: unidirecional server→client, reconnect automático no browser, sem framework, atravessa proxies HTTP/1.1 trivialmente.

## Tradeoffs

- **Duplicação possível** (NATS subscriber + poll detectam mesma msg). Mitigamos não persistindo em `khal.messages` — fonte da verdade é `public.messages` do Omni, lido na hora pelo painel. O SSE emit duplicado triggera `hx-get` 2x, custa um round-trip extra: aceitável.
- **Poll de 2s não é "verdadeiro tempo real"**. Pra demo, 2s de latência outgoing está ótimo. Caminho pra reduzir: Postgres `LISTEN/NOTIFY` em trigger de `public.messages` (anti-escopo agora).
- **Postgres é fonte da verdade de mensagens** acopla o cx-demo ao schema interno do Omni (`public.chats`, `public.messages`). Risco de quebrar em upgrade do Omni. ADR aceita esse acoplamento porque é a única forma de ver outgoing sem mexer no Omni.

## Mapeamento NATS chat ↔ Khal customer

Quando msg chega em `omni.message.<inst>.<chatId>`, `chatId` é o **external_id** do WhatsApp (ex.: `15809908895839@lid` — formato Linked ID). Mas customer no nosso banco tem phone E.164 (ex.: `+553496605400`). O NATS subscriber faz lookup em `public.chats.canonical_id` (o E.164 real) antes de bater no `khal.customers.phone`. Auto-cria customer placeholder ("Cliente +55…") se não existir — assim o avaliador testa do próprio WhatsApp sem precisar de seed.

## Alternativas descartadas

- **Modificar Omni pra publicar outgoing em NATS**: invasivo, anti-escopo (não somos donos do Omni).
- **Polling-only (sem NATS)**: simples mas degrada UX (2s latência mesmo no incoming, onde NATS dá <100ms).
- **NATS-only (sem poll)**: perde 100% das outgoing.
- **WebSocket bidirecional**: overkill — não precisamos client→server (HTTP REST cobre).
