# ADR 002 — Confirmação humana em 2 passos para write actions

**Data:** 2026-06-18 · **Status:** accepted

## Contexto

Nova chama tools que **escrevem em sistemas externos**: `abrir_ticket` (Linear), `segunda_via_fatura` (URL pública + audit), `escalar_atendente` (Slack). Erros têm custo:

- Ticket aberto por engano consome SLA do time.
- Handoff dispara notificação real pro Slack do CX team.
- Mensagens autônomas têm risco reputacional pra Onyx.

## Decisão

Tools que escrevem em sistema externo seguem **fluxo de 2 passos**:

1. **Nova propõe** o conteúdo numa mensagem WhatsApp com lista numerada (`1 confirmar / 2 cancelar / 3 editar`)
2. **Cliente responde com número** (não com NLP livre)
3. Só então a tool é chamada

A regra é codificada na seção `<principles>` do `AGENTS.md` da Nova ("Confirmação antes de ação que escreve") e reforçada na `description` das tools no MCP server ("SEMPRE confirme com o cliente (lista numerada 1/2/3) antes de chamar").

## Por quê

- **UX nativa do WhatsApp** — listas numeradas são padrão (clientes de telecom já interagem assim com URAs).
- **Reduz ambiguidade do NLP** — "abre o chamado" pode virar 5 tickets se Nova interpretar mal mensagens repetidas. "Responder 1" não tem ambiguidade.
- **Auditabilidade** — fácil rastrear no log: cliente confirmou X às tal hora.
- **Reversibilidade leve** — entre proposta e execução tem uma janela natural pro cliente reconsiderar.

## Alternativa descartada

Confirmação por linguagem natural ("digita 'confirmo'") — sujeita a typo, falsos negativos e abertura acidental.
