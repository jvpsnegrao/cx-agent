# ADR 008 — Jornada de cadastro de novo cliente via WhatsApp

**Data:** 2026-06-20 · **Status:** accepted

## Contexto

A persona Nova era inicialmente desenhada pra atender **clientes já cadastrados** da Onyx Telecom — quem manda msg primeiro precisa ter sido seedado/criado no painel. Cliente desconhecido (qualquer número que não está em `khal.customers`) ou era auto-criado como `Cliente +55…` placeholder (sem nome, plano default) ou recebia "Cliente não encontrado" e ficava sem ação.

Pra demo realista do produto — avaliador testando do próprio WhatsApp (número novo) — esse buraco quebrava o fluxo. Avaliador manda "oi" e a Nova diz "você não está aqui" e fica.

## Decisão

Adicionar **jornada completa de onboarding** via Nova:

1. Nova detecta cliente desconhecido (`consultar_conta` retorna "Cliente não encontrado")
2. Pergunta se quer assinar
3. Coleta **nome**
4. Chama `listar_planos()` → mostra 3 planos numerados (1/2/3)
5. Cliente escolhe pela lista
6. Nova pede **CEP** e **número**
7. Opcionalmente complemento
8. Chama `criar_cliente(phone, nome, planoId, cep, numero, complemento?)` — cadastra customer **e** abre ticket de instalação automático
9. Confirma identifier `ONYX-N` ao cliente

Implementação:
- **Schema**: tabela `khal.plans` (id, name, monthly_value_cents, data_allowance_gb, active)
- **Customers** ganha `plan_id` FK, `cep`, `numero`, `complemento` (mantém `address` legacy pra compat)
- **3 planos seedados**: Light 20GB R$ 59,90, Pro 50GB R$ 89,90, Premium 100GB R$ 149,90
- **Tools MCP novas**: `listar_planos` (returns 3 planos do DB) e `criar_cliente` (insert + ticket)
- **Domain**: `packages/cx-tools/src/domain/onboarding.ts:createCustomerWithInstallTicket` — atômica, faz insert customer + create conversation + cxDemo.createIssue
- **AGENTS.md**: seção `<onboarding>` com 9 passos do fluxo + regras (não pedir CPF/email, não inventar plano)
- **Painel**: form de cadastro cliente vira select de planos + 3 campos endereço com autofill ViaCEP

Auto-create placeholder do NATS subscriber continua funcionando pra **histórico de conversas** quando msg chega de número novo — mas a Nova agora **substitui** esse placeholder via `criar_cliente` (mesmo phone, dados reais).

## Por quê

- **Demo completa**: avaliador testa do próprio número sem precisar editar DB ou seedar
- **Realista de produto**: telecoms reais fazem self-service onboarding por canal
- **Reusa stack existente**: nada de novo — tabela + tools + AGENTS.md + form. Domain segue padrão de `createTicket`/`escalateHumanHandoff`
- **Audit trail**: ação registrada em `khal.audit_log` com `action='criar_cliente'` + plano + identifier do ticket

## Trade-offs

- **Schema migration nova**: 1 tabela + 4 colunas em customers. Mitigação: `plan_id` é nullable, customers antigos sobrevivem com `address` livre
- **`tickets.linearId` mantém nome legacy** — `ONYX-N` do ticket de instalação vai no mesmo campo. Rename ainda deferido
- **ViaCEP fora do MCP**: Nova passa CEP cru (8 dígitos) e cx-tools só valida formato. Autofill (logradouro/bairro/cidade) é só no painel web — Nova confia no número da casa que cliente informa
- **Cliente pode mentir endereço**: anti-escopo a validação de logradouro. Equipe técnica valida na visita
- **Sem fluxo de "estou em área não atendida"** — Nova abre ticket de qualquer CEP. Anti-escopo

## Alternativas descartadas

- **Form web pra cliente preencher** (link da Nova com auth temp) — mais setup, demo perde a "WhatsApp end-to-end"
- **Pedir CPF + checar SPC/Serasa** — anti-escopo, demo
- **Multi-plano por cliente** — anti-escopo
- **Plano custom (cliente sugere preço)** — anti-escopo
