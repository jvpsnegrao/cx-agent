import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { auditLog, bills, conversations, customers, messages, tickets } from '@khal/db';
import { createDb } from '@khal/db';
import { buildCustomerSummary, findCustomerByPhone, formatCustomerSummary } from '../src/domain/customer.ts';
import { gerarSegundaVia } from '../src/domain/fatura.ts';
import { createTicket } from '../src/domain/ticket.ts';
import { escalateHumanHandoff } from '../src/domain/handoff.ts';
import type { TicketBackend } from '../src/domain/ticket.ts';
import type { HandoffBackend } from '../src/domain/handoff.ts';

/**
 * Testes de comportamento do agente — exercem o domain das tools direto,
 * com fake adapters (cxDemo/Linear/Slack) e DB real. Cobrem cenários de uso
 * fim-a-fim que a Nova encontra no WhatsApp.
 */

const DB_URL = process.env.KHAL_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/omni';
const db = createDb(DB_URL);

const phone = `+9${Math.floor(Math.random() * 1e10).toString().padStart(10, '0')}`;
let customerId: string;
let billOpenId: string;
let billPaidId: string;
let conversationId: string;

beforeAll(async () => {
  // Cliente de teste isolado pra não interferir com seed
  const [customer] = await db
    .insert(customers)
    .values({
      phone,
      name: 'Cliente Teste Bun',
      plan: 'Test 10GB',
      monthlyValue: 5990,
      dataAllowanceGb: 10,
      dataUsedGb: 4,
      address: 'Rua Test, 0',
      status: 'active',
    })
    .returning();
  customerId = customer.id;

  const [openBill] = await db
    .insert(bills)
    .values({
      customerId,
      referenceMonth: '2026-12',
      amountCents: 5990,
      dueDate: new Date('2026-12-15'),
      status: 'open',
    })
    .returning();
  billOpenId = openBill.id;

  const [paidBill] = await db
    .insert(bills)
    .values({
      customerId,
      referenceMonth: '2026-11',
      amountCents: 5990,
      dueDate: new Date('2026-11-15'),
      status: 'paid',
    })
    .returning();
  billPaidId = paidBill.id;

  const [conv] = await db
    .insert(conversations)
    .values({ customerId, lastSentiment: 'neutro' })
    .returning();
  conversationId = conv.id;

  // Mensagens recentes pra handoff hidratar
  await db.insert(messages).values([
    { conversationId, role: 'customer', content: 'minha net caiu' },
    { conversationId, role: 'nova', content: 'já abri um chamado pra vc' },
    { conversationId, role: 'customer', content: 'quero falar com gente' },
  ]);
});

afterAll(async () => {
  if (customerId) await db.delete(customers).where(eq(customers.id, customerId)).catch(() => {});
  await db.delete(customers).where(eq(customers.name, 'Cliente Teste Bun')).catch(() => {});
});

// ───── consultar_conta ─────

describe('consultar_conta', () => {
  it('retorna resumo completo pra cliente existente', async () => {
    const summary = await buildCustomerSummary(db, phone);
    expect(summary).not.toBeNull();
    expect(summary?.name).toBe('Cliente Teste Bun');
    expect(summary?.plan).toBe('Test 10GB');
    expect(summary?.monthlyValue).toBe(5990);
    expect(summary?.dataUsedGb).toBe(4);
    expect(summary?.dataAllowanceGb).toBe(10);
    expect(summary?.status).toBe('active');
    expect(summary?.nextBill).not.toBeNull();
    expect(summary?.nextBill?.referenceMonth).toBe('2026-11');
  });

  it('retorna null pra phone que não está cadastrado', async () => {
    const summary = await buildCustomerSummary(db, '+1000000000000');
    expect(summary).toBeNull();
  });

  it('format do resumo é legível em PT-BR com R$ formatado', () => {
    const text = formatCustomerSummary({
      id: customerId,
      name: 'Cliente Teste Bun',
      plan: 'Test 10GB',
      monthlyValue: 5990,
      dataAllowanceGb: 10,
      dataUsedGb: 4,
      status: 'active',
      nextBill: {
        referenceMonth: '2026-12',
        amountCents: 5990,
        dueDate: new Date('2026-12-15T00:00:00Z'),
        status: 'open',
      },
    });
    expect(text).toContain('Cliente Teste Bun');
    expect(text).toContain('R$ 59,90');
    expect(text).toContain('4GB de 10GB');
    expect(text).toContain('Próxima fatura');
  });
});

// ───── segunda_via_fatura ─────

describe('segunda_via_fatura', () => {
  it('gera URL + grava audit_log quando fatura existe', async () => {
    const result = await gerarSegundaVia(db, customerId, billOpenId);
    expect(result.pdfUrl).toMatch(/^https:\/\/onyx\.tel\/fatura\/.+\.pdf$/);
    expect(result.amountCents).toBe(5990);
    expect(result.referenceMonth).toBe('2026-12');

    // confirma audit_log gravado
    const audit = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.customerId, customerId))
      .orderBy(auditLog.createdAt);
    const segundaVia = audit.find((a) => a.action === 'segunda_via_fatura');
    expect(segundaVia).toBeTruthy();
    expect(segundaVia?.result).toBe('ok');
  });

  it('throws quando billId não pertence ao customer', async () => {
    const fakeBillId = '00000000-0000-0000-0000-000000000000';
    await expect(gerarSegundaVia(db, customerId, fakeBillId)).rejects.toThrow();
  });
});

// ───── abrir_ticket ─────

describe('abrir_ticket', () => {
  it('invoca adapter, persiste ticket e grava audit_log com identifier', async () => {
    let captured: Parameters<TicketBackend['createIssue']>[0] | undefined;
    const fakeAdapter: TicketBackend = {
      createIssue: async (input) => {
        captured = input;
        return { id: 'fake-id-123', identifier: 'ONYX-TEST-1' };
      },
    };

    const result = await createTicket(db, fakeAdapter, {
      customerId,
      customerName: 'Cliente Teste Bun',
      title: 'internet caiu',
      category: 'rede',
      priority: 'high',
      description: 'sem conexão há 2h',
    });

    expect(result.externalId).toBe('ONYX-TEST-1');
    expect(captured?.title).toBe('internet caiu');
    expect(captured?.category).toBe('rede');
    expect(captured?.priority).toBe('high');

    const persistedTickets = await db.select().from(tickets).where(eq(tickets.id, result.ticketId));
    expect(persistedTickets[0]?.externalId).toBe('ONYX-TEST-1');
    expect(persistedTickets[0]?.title).toBe('internet caiu');
    expect(persistedTickets[0]?.status).toBe('open');

    const audit = await db.select().from(auditLog).where(eq(auditLog.customerId, customerId));
    expect(audit.some((a) => a.action === 'abrir_ticket' && a.result === 'ok')).toBe(true);
  });

  it('propaga erro do adapter (backend down) sem persistir lixo', async () => {
    const failingAdapter: TicketBackend = {
      createIssue: async () => {
        throw new Error('cx-demo /api/v1/tickets 503');
      },
    };

    await expect(
      createTicket(db, failingAdapter, {
        customerId,
        customerName: 'Cliente Teste Bun',
        title: 'erro esperado',
        category: 'test',
        priority: 'low',
        description: 'deve falhar',
      }),
    ).rejects.toThrow(/cx-demo/);

    // Confirma que NÃO criou ticket "erro esperado" no DB
    const fail = await db
      .select()
      .from(tickets)
      .where(eq(tickets.title, 'erro esperado'));
    expect(fail.length).toBe(0);
  });
});

// ───── escalar_atendente ─────

describe('escalar_atendente', () => {
  it('atualiza conversation com humanTakeoverAt + sentiment correto', async () => {
    let capturedPayload: Parameters<HandoffBackend['postHandoff']>[0] | undefined;
    const fakeSlack: HandoffBackend = {
      postHandoff: async (p) => {
        capturedPayload = p;
      },
    };

    await escalateHumanHandoff(db, fakeSlack, {
      customerId,
      customerName: 'Cliente Teste Bun',
      customerPhone: phone,
      customerPlan: 'Test 10GB',
      conversationId,
      sentiment: 'frustrado',
      resumo: 'cliente sem net há 2h, já tentou tudo',
    });

    const [convo] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
    expect(convo?.lastSentiment).toBe('frustrado');
    expect(convo?.humanTakeoverAt).toBeTruthy();

    const audit = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.customerId, customerId));
    expect(audit.some((a) => a.action === 'escalar_atendente' && a.result === 'ok')).toBe(true);
  });

  it('envia últimas 3 mensagens no payload do handoff (contexto pro humano)', async () => {
    let captured: Parameters<HandoffBackend['postHandoff']>[0] & { lastMessages: string[] };
    const fakeSlack: HandoffBackend = {
      postHandoff: async (p) => {
        captured = p;
      },
    };

    await escalateHumanHandoff(db, fakeSlack, {
      customerId,
      customerName: 'Cliente Teste Bun',
      customerPhone: phone,
      customerPlan: 'Test 10GB',
      conversationId,
      sentiment: 'urgente',
      resumo: 'precisa atender agora',
    });

    expect(captured!.lastMessages).toHaveLength(3);
    expect(captured!.lastMessages[0]).toContain('[customer]');
    expect(captured!.lastMessages.some((m) => m.includes('quero falar com gente'))).toBe(true);
    expect(captured!.sentiment).toBe('urgente');
    expect(captured!.resumo).toBe('precisa atender agora');
  });
});

// ───── findCustomerByPhone ─────

describe('findCustomerByPhone', () => {
  it('match exato por E.164', async () => {
    const found = await findCustomerByPhone(db, phone);
    expect(found?.id).toBe(customerId);
  });

  it('retorna null pra phone vazio', async () => {
    const found = await findCustomerByPhone(db, '');
    expect(found).toBeNull();
  });
});
