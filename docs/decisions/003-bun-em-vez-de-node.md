# ADR 003 — Bun como runtime único

**Data:** 2026-06-18 · **Status:** accepted

## Contexto

Genie e Omni são **Bun-only** por design — o `CLAUDE.md` de cada repo declara isso como regra dura ("If you catch yourself about to run a prohibited command, STOP and use the Bun equivalent"). Genie spawn `bun` quando inicia o agent runtime.

## Decisão

Todo código nosso (MCP server, cron, db package) roda em **Bun**, não Node. Scripts em `package.json` usam `bun`, não `npm`/`node`. Testes via `bun test` (não vitest). Bundler via `bun build` se precisar.

## Por quê

- **Compatibilidade** — agent dir tem que carregar `.mcp.json` que aponta pra `bun run server.ts`. Misturar Node ali quebra ergonomia.
- **Padrão da casa** — alinhamento total com Genie/Omni demonstra fluência no stack.
- **Performance e DX** — TS sem transpilação, startup mais rápido, stdlib nativa pra fs/path/crypto.
- **Um runtime, uma lockfile** — `bun.lock` em vez de `package-lock.json` + dev deps.

## Trade-offs

- Curva pra quem só usou Node (mitigado: superfície é quase 1:1).
- Algumas libs com nativos têm gotchas no Bun (`postgres` lib funciona bem; `@linear/sdk` validado em testes).

## Alternativa descartada

Node 24 (LTS) — funcionaria pra nosso MCP server, mas não pro agent dir. Manter 2 runtimes na mesma stack é confusão sem ganho.
