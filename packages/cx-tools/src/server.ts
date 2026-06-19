#!/usr/bin/env bun
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { db } from './db/client.ts';
import { createLinearAdapter } from './adapters/linear.ts';
import { createSlackAdapter } from './adapters/slack.ts';
import { buildCustomerSummary, formatCustomerSummary, findCustomerByPhone } from './domain/customer.ts';
import { createTicket } from './domain/ticket.ts';
import { escalateHumanHandoff } from './domain/handoff.ts';
import { gerarSegundaVia } from './domain/fatura.ts';
import { and, desc, eq } from 'drizzle-orm';
import { bills, conversations } from '@khal/db';

const LINEAR_API_KEY = process.env.LINEAR_API_KEY ?? '';
const LINEAR_TEAM_KEY = process.env.LINEAR_TEAM_ID ?? 'ONYX';
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL ?? '';

const linear = LINEAR_API_KEY ? createLinearAdapter(LINEAR_API_KEY, LINEAR_TEAM_KEY) : null;
const slack = SLACK_WEBHOOK_URL ? createSlackAdapter(SLACK_WEBHOOK_URL) : null;

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
    description: 'Escala pro time humano via Slack com resumo+sentiment. Use quando cliente pedir ou caso ficar inviável.',
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
];

const server = new Server({ name: 'khal-cx-tools', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  if (name === 'consultar_conta') {
    const { phone } = consultarSchema.parse(args);
    const summary = await buildCustomerSummary(db, phone);
    if (!summary) return { content: [{ type: 'text', text: `Cliente com telefone ${phone} não encontrado.` }] };
    return { content: [{ type: 'text', text: formatCustomerSummary(summary) }] };
  }

  if (name === 'segunda_via_fatura') {
    const { phone } = segundaViaSchema.parse(args);
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
    return {
      content: [
        {
          type: 'text',
          text: `2ª via gerada: ${result.pdfUrl}\nValor: R$ ${(result.amountCents / 100).toFixed(2)} — vence ${result.dueDate.toLocaleDateString('pt-BR')}`,
        },
      ],
    };
  }

  if (name === 'abrir_ticket') {
    if (!linear) {
      return {
        isError: true,
        content: [{ type: 'text', text: 'LINEAR_API_KEY não configurada — chamado não pode ser aberto.' }],
      };
    }
    const input = abrirTicketSchema.parse(args);
    const customer = await findCustomerByPhone(db, input.phone);
    if (!customer) {
      return { isError: true, content: [{ type: 'text', text: `Cliente ${input.phone} não encontrado.` }] };
    }
    const { ticketId, linearId } = await createTicket(db, linear, {
      customerId: customer.id,
      customerName: customer.name,
      title: input.titulo,
      category: input.categoria,
      priority: input.prioridade,
      description: input.descricao,
    });
    return {
      content: [{ type: 'text', text: `Chamado ${linearId} aberto (id interno ${ticketId}). Previsão até 24h.` }],
    };
  }

  if (name === 'escalar_atendente') {
    if (!slack) {
      return {
        isError: true,
        content: [{ type: 'text', text: 'SLACK_WEBHOOK_URL não configurada — handoff bloqueado.' }],
      };
    }
    const input = escalarSchema.parse(args);
    const customer = await findCustomerByPhone(db, input.phone);
    if (!customer) {
      return { isError: true, content: [{ type: 'text', text: `Cliente ${input.phone} não encontrado.` }] };
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
    await escalateHumanHandoff(db, slack, {
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

  return { isError: true, content: [{ type: 'text', text: `Tool desconhecida: ${name}` }] };
});

await server.connect(new StdioServerTransport());
