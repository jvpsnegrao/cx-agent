# ADR 001 — Piggyback no `omni-pgserve` (schema `khal_*`)

**Data:** 2026-06-18 · **Status:** accepted

## Contexto

Omni já sobe um Postgres embedded (`omni-pgserve`) em `localhost:8432` para suas próprias tabelas (channels, messages, providers). Precisamos de Postgres para: clientes mockados, conversas, audit, idempotency de cron.

## Decisão

Usar o **mesmo Postgres do Omni**, isolado por schema dedicado `khal`. Nossas tabelas viram `khal.customers`, `khal.bills`, etc.

## Por quê

- **Zero infra adicional** — `docker-compose up` não é necessário, e o setup do avaliador permanece 1-comando (`make install`).
- **Demonstra fluência no stack da casa** — Omni usa Drizzle no mesmo Postgres, nossa decisão segue o padrão.
- **Isolamento físico via schema** é suficiente pra um agente single-tenant; não precisamos de DB separado.
- Postgres "shared, schema-isolated" é o padrão de multi-tenancy soft em SaaS — escolha aderente, não amadora.

## Trade-offs

- Acidente operacional num `DROP SCHEMA` errado pode atingir o Omni (mitigado por schema explícito em todas queries).
- Migrations do nosso lado podem competir com auto-migrate do Omni no boot (mitigado por nome de schema único; `__drizzle_migrations` compartilhada não conflita pois nossas migrations têm names distintos).

## Alternativa descartada

DB separado (`khal` em vez de `omni`) ou container Postgres próprio — mais limpo conceitualmente mas adiciona infra sem ganho real nesse escopo de 3 dias.
