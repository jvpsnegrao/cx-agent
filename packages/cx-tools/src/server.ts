#!/usr/bin/env bun
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { db } from './db/client.ts';
import { createCxDemoAdapter } from './adapters/cx-demo.ts';
import { buildCustomerSummary, formatCustomerSummary, findCustomerByPhone } from './domain/customer.ts';
import { createTicket } from './domain/ticket.ts';
import { escalateHumanHandoff } from './domain/handoff.ts';
import { gerarSegundaVia } from './domain/fatura.ts';
import { and, desc, eq, sql } from 'drizzle-orm';
import { bills, conversations, plans, tickets } from '@khal/db';
import { createCustomerWithInstallTicket } from './domain/onboarding.ts';

/**
 * Normaliza qualquer input de phone — aceita:
 *   - E.164 ("+553496605400") → retorna como está
 *   - chat_id WhatsApp ("15809908895839@lid", "5511999990001@s.whatsapp.net")
 *     → busca canonical_id em public.chats do Omni e retorna +E164
 *   - dígitos puros → prefix +
 *
 * Resolve o caso do Nova receber chat: <jid> no contexto em vez do phone real.
 */
async function resolvePhone(input: string): Promise<string> {
  const trimmed = input.trim();
  if (trimmed.startsWith('+')) return trimmed;
  if (trimmed.includes('@')) {
    const rows = await db.execute<{ canonical_id: string | null }>(sql`
      SELECT canonical_id FROM public.chats WHERE external_id = ${trimmed} LIMIT 1
    `);
    const canonical = rows[0]?.canonical_id;
    if (canonical) {
      const digits = canonical.split('@')[0]?.replace(/[^0-9]/g, '') ?? '';
      if (digits) return `+${digits}`;
    }
    // fallback: pega dígitos do próprio input
    const digits = trimmed.split('@')[0]?.replace(/[^0-9]/g, '') ?? '';
    if (digits) return `+${digits}`;
  }
  const digits = trimmed.replace(/[^0-9]/g, '');
  return digits ? `+${digits}` : trimmed;
}

const CX_DEMO_URL = process.env.CX_DEMO_URL ?? 'http://localhost:3000';
const CX_DEMO_TOKEN = process.env.CX_DEMO_TOKEN ?? '';

const cxDemo = CX_DEMO_TOKEN ? createCxDemoAdapter(CX_DEMO_URL, CX_DEMO_TOKEN) : null;

const consultarSchema = z.object({ phone: z.string().describe('Telefone do cliente em formato E.164') });
const segundaViaSchema = z.object({ phone: z.string() });
const abrirTicketSchema = z.object({
  phone: z.string(),
  titulo: z.string(),
  categoria: z.string(),
  prioridade: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  descricao: z.string(),
});
const escalarSchema = z.object({
  phone: z.string(),
  resumo: z.string().describe('Resumo do problema do cliente — gerado pela Nova'),
  sentiment: z.enum(['neutro', 'frustrado', 'satisfeito', 'urgente']),
});
const listarTicketsSchema = z.object({ phone: z.string() });
const listarFaturasSchema = z.object({ phone: z.string() });
const criarClienteSchema = z.object({
  phone: z.string(),
  nome: z.string().min(1),
  planoId: z.string().uuid().describe('UUID retornado por listar_planos'),
  cep: z.string().min(8).describe('CEP com 8 dígitos (com ou sem hífen)'),
  numero: z.string().min(1),
  complemento: z.string().optional(),
});

const TOOLS = [
  {
    name: 'consultar_conta',
    description: 'Consulta plano, status, consumo e próxima fatura do cliente pelo telefone WhatsApp.',
    inputSchema: { type: 'object', properties: { phone: { type: 'string' } }, required: ['phone'] },
  },
  {
    name: 'segunda_via_fatura',
    description: 'Gera URL da 2ª via da próxima fatura em aberto do cliente.',
    inputSchema: { type: 'object', properties: { phone: { type: 'string' } }, required: ['phone'] },
  },
  {
    name: 'abrir_ticket',
    description:
      'Abre chamado técnico no Linear. SEMPRE confirme com o cliente (lista numerada 1/2/3) antes de chamar.',
    inputSchema: {
      type: 'object',
      properties: {
        phone: { type: 'string' },
        titulo: { type: 'string' },
        categoria: { type: 'string' },
        prioridade: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
        descricao: { type: 'string' },
      },
      required: ['phone', 'titulo', 'categoria', 'descricao'],
    },
  },
  {
    name: 'escalar_atendente',
    description: 'Escala pro time humano com resumo+sentiment. Use quando cliente pedir ou caso ficar inviável.',
    inputSchema: {
      type: 'object',
      properties: {
        phone: { type: 'string' },
        resumo: { type: 'string' },
        sentiment: { type: 'string', enum: ['neutro', 'frustrado', 'satisfeito', 'urgente'] },
      },
      required: ['phone', 'resumo', 'sentiment'],
    },
  },
  {
    name: 'consultar_tickets',
    description:
      'Lista os chamados (tickets) do cliente — abertos e fechados. Use quando o cliente perguntar "meus chamados", "como está meu ticket", "qual é a previsão" etc.',
    inputSchema: { type: 'object', properties: { phone: { type: 'string' } }, required: ['phone'] },
  },
  {
    name: 'consultar_faturas',
    description:
      'Lista as faturas/cobranças do cliente (em aberto, pagas, vencidas). Use quando o cliente perguntar "minhas faturas", "minhas cobranças", "o que devo".',
    inputSchema: { type: 'object', properties: { phone: { type: 'string' } }, required: ['phone'] },
  },
  {
    name: 'listar_planos',
    description:
      'Lista os planos da Onyx disponíveis pra novo cliente. Use no onboarding antes de criar_cliente, leia os planos com lista numerada (1/2/3) e aguarde o cliente escolher.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'criar_cliente',
    description:
      'Cadastra novo cliente NO MOMENTO E abre ticket de instalação automaticamente. Use SÓ após (a) consultar_conta ter retornado "não encontrado", (b) cliente confirmar querer assinar, (c) coletar nome, escolha do plano via listar_planos, CEP e número.',
    inputSchema: {
      type: 'object',
      properties: {
        phone: { type: 'string' },
        nome: { type: 'string' },
        planoId: { type: 'string', description: 'UUID do plano (retornado por listar_planos)' },
        cep: { type: 'string' },
        numero: { type: 'string' },
        complemento: { type: 'string' },
      },
      required: ['phone', 'nome', 'planoId', 'cep', 'numero'],
    },
  },
];

const server = new Server({ name: 'khal-cx-tools', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  if (name === 'consultar_conta') {
    const parsed = consultarSchema.parse(args);
    const phone = await resolvePhone(parsed.phone);
    const summary = await buildCustomerSummary(db, phone);
    if (!summary) return { content: [{ type: 'text', text: `Cliente com telefone ${phone} não encontrado.` }] };
    return { content: [{ type: 'text', text: formatCustomerSummary(summary) }] };
  }

  if (name === 'segunda_via_fatura') {
    const parsed = segundaViaSchema.parse(args);
    const phone = await resolvePhone(parsed.phone);
    const customer = await findCustomerByPhone(db, phone);
    if (!customer) return { content: [{ type: 'text', text: `Cliente ${phone} não encontrado.` }] };

    const [openBill] = await db
      .select()
      .from(bills)
      .where(and(eq(bills.customerId, customer.id), eq(bills.status, 'open')))
      .orderBy(bills.dueDate)
      .limit(1);
    if (!openBill) return { content: [{ type: 'text', text: 'Nenhuma fatura em aberto.' }] };

    const result = await gerarSegundaVia(db, customer.id, openBill.id);

    // Envia PDF como anexo via cx-demo (que chama Omni /send/media).
    // Fire-and-forget no cx-demo, então essa chamada retorna em ~ms.
    let sendErr: string | null = null;
    if (CX_DEMO_TOKEN) {
      try {
        const res = await fetch(`${CX_DEMO_URL}/api/v1/bills/${openBill.id}/send-pdf`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CX_DEMO_TOKEN}` },
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) sendErr = `cx-demo ${res.status}: ${(await res.text()).slice(0, 100)}`;
      } catch (err) {
        sendErr = err instanceof Error ? err.message : String(err);
      }
    } else {
      sendErr = 'CX_DEMO_TOKEN não configurada';
    }

    const valor = `R$ ${(result.amountCents / 100).toFixed(2).replace('.', ',')}`;
    const venc = result.dueDate.toLocaleDateString('pt-BR');
    const ref = result.referenceMonth;
    if (sendErr) {
      return {
        content: [
          {
            type: 'text',
            text: `2ª via gerada mas falhou enviar anexo (${sendErr}). Dados: ${ref} · ${valor} · vence ${venc}.`,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text',
          text: `Mandei o PDF da 2ª via aqui no seu Zap como anexo. Resumo: ${ref}, ${valor}, vencendo ${venc}.`,
        },
      ],
    };
  }

  if (name === 'abrir_ticket') {
    if (!cxDemo) {
      return {
        isError: true,
        content: [{ type: 'text', text: 'CX_DEMO_TOKEN não configurada — chamado não pode ser aberto.' }],
      };
    }
    const input = abrirTicketSchema.parse(args);
    const phone = await resolvePhone(input.phone);
    const customer = await findCustomerByPhone(db, phone);
    if (!customer) {
      return { isError: true, content: [{ type: 'text', text: `Cliente ${phone} não encontrado.` }] };
    }
    const { ticketId, externalId } = await createTicket(db, cxDemo, {
      customerId: customer.id,
      customerName: customer.name,
      title: input.titulo,
      category: input.categoria,
      priority: input.prioridade,
      description: input.descricao,
    });
    return {
      content: [{ type: 'text', text: `Chamado ${externalId} aberto (id interno ${ticketId}). Previsão até 24h.` }],
    };
  }

  if (name === 'escalar_atendente') {
    if (!cxDemo) {
      return {
        isError: true,
        content: [{ type: 'text', text: 'CX_DEMO_TOKEN não configurada — handoff bloqueado.' }],
      };
    }
    const input = escalarSchema.parse(args);
    const phone = await resolvePhone(input.phone);
    const customer = await findCustomerByPhone(db, phone);
    if (!customer) {
      return { isError: true, content: [{ type: 'text', text: `Cliente ${phone} não encontrado.` }] };
    }
    const [convo] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.customerId, customer.id))
      .orderBy(desc(conversations.startedAt))
      .limit(1);
    if (!convo) {
      return { isError: true, content: [{ type: 'text', text: 'Conversa ativa não encontrada.' }] };
    }
    await escalateHumanHandoff(db, cxDemo, {
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      customerPlan: customer.plan,
      conversationId: convo.id,
      resumo: input.resumo,
      sentiment: input.sentiment,
    });
    return {
      content: [
        { type: 'text', text: `Handoff enviado pro time. Cliente vai ser atendido por humano em instantes.` },
      ],
    };
  }

  if (name === 'consultar_tickets') {
    const parsed = listarTicketsSchema.parse(args);
    const phone = await resolvePhone(parsed.phone);
    const customer = await findCustomerByPhone(db, phone);
    if (!customer) return { content: [{ type: 'text', text: `Cliente ${phone} não encontrado.` }] };
    const rows = await db
      .select()
      .from(tickets)
      .where(eq(tickets.customerId, customer.id))
      .orderBy(desc(tickets.createdAt))
      .limit(10);
    if (rows.length === 0) {
      return { content: [{ type: 'text', text: `${customer.name}, você não tem chamados abertos.` }] };
    }
    const lines = rows.map(
      (t) => `• ${t.externalId ?? '—'} [${t.status}] ${t.title} (prioridade: ${t.priority})`,
    );
    return {
      content: [
        {
          type: 'text',
          text: `Chamados de ${customer.name}:\n${lines.join('\n')}`,
        },
      ],
    };
  }

  if (name === 'consultar_faturas') {
    const parsed = listarFaturasSchema.parse(args);
    const phone = await resolvePhone(parsed.phone);
    const customer = await findCustomerByPhone(db, phone);
    if (!customer) return { content: [{ type: 'text', text: `Cliente ${phone} não encontrado.` }] };
    const rows = await db
      .select()
      .from(bills)
      .where(eq(bills.customerId, customer.id))
      .orderBy(desc(bills.dueDate))
      .limit(12);
    if (rows.length === 0) {
      return { content: [{ type: 'text', text: `${customer.name}, não tem faturas cadastradas.` }] };
    }
    const lines = rows.map((b) => {
      const v = (b.amountCents / 100).toFixed(2).replace('.', ',');
      const due = new Date(b.dueDate).toLocaleDateString('pt-BR');
      return `• ${b.referenceMonth} · R$ ${v} · vence ${due} · ${b.status}`;
    });
    return {
      content: [
        {
          type: 'text',
          text: `Faturas de ${customer.name}:\n${lines.join('\n')}`,
        },
      ],
    };
  }

  if (name === 'listar_planos') {
    const rows = await db.select().from(plans).where(eq(plans.active, true)).orderBy(plans.monthlyValueCents);
    if (rows.length === 0) {
      return { content: [{ type: 'text', text: 'Nenhum plano ativo cadastrado.' }] };
    }
    const lines = rows.map((p, i) => {
      const v = (p.monthlyValueCents / 100).toFixed(2).replace('.', ',');
      return `${i + 1}. ${p.name} — R$ ${v}/mês — franquia ${p.dataAllowanceGb}GB (id: ${p.id})`;
    });
    return {
      content: [
        {
          type: 'text',
          text: `Planos Onyx disponíveis:\n${lines.join('\n')}\n\nAo confirmar a escolha com o cliente, use o id do plano em criar_cliente.`,
        },
      ],
    };
  }

  if (name === 'criar_cliente') {
    if (!cxDemo) {
      return {
        isError: true,
        content: [{ type: 'text', text: 'CX_DEMO_TOKEN não configurada — cadastro não pode ser feito.' }],
      };
    }
    const parsed = criarClienteSchema.parse(args);
    const phone = await resolvePhone(parsed.phone);
    const cep = parsed.cep.replace(/[^0-9]/g, '');
    if (cep.length !== 8) {
      return { isError: true, content: [{ type: 'text', text: `CEP inválido (${parsed.cep}) — precisa 8 dígitos.` }] };
    }
    try {
      const result = await createCustomerWithInstallTicket(db, cxDemo, {
        phone,
        nome: parsed.nome.trim(),
        planoId: parsed.planoId,
        cep,
        numero: parsed.numero.trim(),
        complemento: parsed.complemento?.trim(),
      });
      const valor = (result.monthlyValueCents / 100).toFixed(2).replace('.', ',');
      const venc = result.primeiraFaturaDueDate.toLocaleDateString('pt-BR');
      return {
        content: [
          {
            type: 'text',
            text: `Cadastro feito! Plano ${result.planName} (R$ ${valor}/mês). Endereço (ViaCEP): ${result.enderecoCompleto}. Chamado ${result.identifier} aberto — equipe técnica vai entrar em contato em até 24h pra agendar a instalação. Primeira fatura gerada (R$ ${valor}) com vencimento em ${venc}.`,
          },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Erros conhecidos têm prefixo (DUPLICATE_PHONE, INVALID_CEP) — Nova pode reagir diferente
      if (msg.startsWith('DUPLICATE_PHONE:')) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Esse telefone já tem cadastro no sistema. Use consultar_conta primeiro pra confirmar — se a conta existe mas está inativa/placeholder, escale pra atendente humano via escalar_atendente.`,
            },
          ],
        };
      }
      if (msg.startsWith('INVALID_CEP:')) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `O CEP ${parsed.cep} não foi reconhecido. Peça pro cliente confirmar o CEP (formato 00000-000) e tente de novo.`,
            },
          ],
        };
      }
      return { isError: true, content: [{ type: 'text', text: `Falha ao criar cliente: ${msg}` }] };
    }
  }

  return { isError: true, content: [{ type: 'text', text: `Tool desconhecida: ${name}` }] };
});

await server.connect(new StdioServerTransport());
