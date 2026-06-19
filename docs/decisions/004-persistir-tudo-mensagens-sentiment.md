# ADR 004 — Persistir todas as msgs + sentiment, em vez de confiar só no Claude `--resume`

**Data:** 2026-06-18 · **Status:** accepted

## Contexto

Genie spawn `claude --resume <session>` por cliente, e Claude mantém histórico de mensagens via sua própria session store. **A memória conversacional vem de graça** — Nova lê histórico sem código nosso.

Mesmo assim, optamos por persistir as mensagens em `khal.messages` (+ `khal.conversations.last_sentiment`).

## Decisão

Toda mensagem que entra/sai (cliente, Nova, tool, system) é gravada em `khal.messages`. Cada conversa tem `conversations.last_sentiment` atualizado quando `escalar_atendente` é chamada.

## Por quê

- **Audit e replay** — em caso de incidente ("Nova abriu chamado errado pra cliente X"), preciso reconstituir a conversa sem depender da session do Claude (que é local ao agent dir, não exportável fácil).
- **Tool `escalar_atendente` precisa de últimas 3 msgs** pro resumo no Slack — fica trivial pulando direto no Postgres (`ORDER BY created_at DESC LIMIT 3`).
- **Métrica de CX** — mais pra frente, dá pra fazer cohort de sentiment, NPS, etc., sem reler logs do Claude.
- **Independência de Claude session storage** — se mudarmos provider (futuro), histórico segue lá.

## Trade-offs

- **Duplicação parcial** com o que Claude já guarda — aceitamos, custo é baixo.
- **Sincronização** — Nova grava a mensagem dela, e o sistema grava a mensagem do cliente. Risco de drift se um falhar (mitigação: cada handler de in/out grava antes de continuar).

## Alternativa descartada

Confiar 100% no Claude `--resume` — economia ilusória (não rola pra audit/Slack handoff).
