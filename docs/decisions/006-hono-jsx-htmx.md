# ADR 006 — Painel em Hono + JSX SSR + HTMX (sem React, sem build step)

**Data:** 2026-06-20 · **Status:** accepted

## Contexto

ADR 005 trouxe o `apps/cx-demo/` com painel web. Precisamos escolher a stack do frontend desse painel sabendo que o requisito é estritamente "live demo" (5 tabs read-mostly, interatividade simples: claim handoff, mudar status ticket).

Opções consideradas:

| Opção | Pro | Contra |
|---|---|---|
| **Hono + JSX SSR + HTMX** | Bun-puro, zero build, mesma stack do Omni (Hono+Drizzle), server-rendered | Menos "moderno" |
| Next.js App Router | Visual mais polido, deploy Vercel fácil | Adiciona Node/Next deps, build separado, cwd diferente, complica setup |
| Astro | Server-first como Hono, ilhas React opcional | Outra ferramenta no monorepo |
| Vite + React SPA | Demo mais "rica" | Build separado, mais código de plumbing |

## Decisão

**Hono + JSX SSR + HTMX**, com Tailwind via CDN. Tudo server-rendered, partials via HTMX swap (`hx-get="/partials/..."` + `hx-trigger="sse:event-name from:body"`). Sem build step.

## Por quê

- **Mesma stack do Omni** (CLAUDE.md do Omni declara Bun + Hono como padrão da casa). Demonstra fluência sem sobrecarga.
- **Zero build step** elimina toda uma classe de problemas no setup do avaliador: nada de `next build`, `vite build`, sourcemaps, hydration mismatch. Editou .tsx → `bun --watch` recarrega.
- **HTMX cobre 100% da interatividade necessária**: refresh de lista via SSE swap, ações com `hx-patch` retornando partial. Sem state management client-side.
- **Latência mínima**: SSR retorna HTML pronto. Tab Conversas com 200 msgs renderiza em ~30ms.
- **Tailwind via CDN** (não compilado) está OK pra demo. Em produção, `bun add tailwindcss` + build seria o caminho — anti-escopo agora.

## Tradeoffs

- **Sem React state**: pra interações mais ricas (drag-and-drop, dashboards interativos), HTMX fica curto. Pra essa demo (lista + ação), basta.
- **Tailwind CDN bloqueia se CDN cair**: documentado como risco no plan. Mitigação seria `bun add htmx.org tailwindcss` + servir local.
- **Não é o stack "vendável" do mercado** (React/Next). Mas o teste é técnico-prático, não comercial.

## Estrutura

```
apps/cx-demo/src/
├── pages/        # JSX SSR components (Shell, Login, Tickets, Handoffs, …)
├── partials/     # (vazio por ora — fragments inline em pages.tsx via hx-get)
├── components/   # Badges, rows compartilhados
├── routes/
│   └── pages.tsx # Hono routes: GET / | POST /login | GET /partials/* | PATCH /actions/*
├── api/          # JSON REST: POST /api/v1/tickets, /handoffs, GET /stream
├── auth.ts       # Bearer + cookie HMAC
└── server.ts     # Hono bootstrap
```

`bunfig.toml` na raiz do projeto define `jsx = "react-jsx"` + `jsxImportSource = "hono/jsx"` pra Bun compilar JSX corretamente. Cada `.tsx` é resolvido pelo Bun em runtime sem pré-build.
