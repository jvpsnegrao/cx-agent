/**
 * Integração: endpoints REST do cx-demo via Hono test client (fetch direto no app).
 * Usa DB real — cleanup no afterAll. Token fake hardcoded; sobrescreve env antes do import.
 */
process.env.CX_DEMO_TOKEN = 'test-token-' + Math.random().toString(36).slice(2, 10);
process.env.CX_DEMO_PASSWORD = 'test-password';
process.env.KHAL_DATABASE_URL =
  process.env.KHAL_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/omni';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { conversations, customers, tickets } from '@khal/db';
import { db } from '../src/db.ts';
import { ticketsApi } from '../src/api/tickets.ts';
import { handoffsApi } from '../src/api/handoffs.ts';

const app = new Hono();
app.route('/api/v1/tickets', ticketsApi);
app.route('/api/v1/handoffs', handoffsApi);

const TOKEN = process.env.CX_DEMO_TOKEN ?? '';
const phone = `+9${Math.floor(Math.random() * 1e10).toString().padStart(10, '0')}`;
let customerId = '';
let conversationId = '';

beforeAll(async () => {
  const [c] = await db
    .insert(customers)
    .values({
      phone,
      name: 'API Test Cust',
      plan: 'Test',
      monthlyValue: 1000,
      dataAllowanceGb: 1,
      dataUsedGb: 0,
      address: '—',
      status: 'active',
    })
    .returning();
  customerId = c.id;
  const [conv] = await db.insert(conversations).values({ customerId }).returning();
  conversationId = conv.id;
});

afterAll(async () => {
  if (customerId) await db.delete(customers).where(eq(customers.id, customerId)).catch(() => {});
  // safety net: limpa qualquer test-leftover (cliente com name 'API Test Cust')
  await db.delete(customers).where(eq(customers.name, 'API Test Cust')).catch(() => {});
});

describe('POST /api/v1/tickets — auth', () => {
  it('400 sem campos obrigatórios', async () => {
    const r = await app.request('/api/v1/tickets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(400);
  });

  it('401 sem Bearer', async () => {
    const r = await app.request('/api/v1/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerId, title: 'x', category: 'y', description: 'z' }),
    });
    expect(r.status).toBe(401);
  });

  it('201 com payload válido + grava no DB com identifier ONYX-N', async () => {
    const r = await app.request('/api/v1/tickets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerId,
        customerName: 'API Test Cust',
        title: 'integration test ' + Date.now(),
        category: 'internet',
        priority: 'high',
        description: 'smoke',
      }),
    });
    expect(r.status).toBe(201);
    const body = (await r.json()) as { id: string; identifier: string };
    expect(body.identifier).toMatch(/^ONYX-\d+$/);
    const [row] = await db.select().from(tickets).where(eq(tickets.id, body.id));
    expect(row).toBeTruthy();
    expect(row?.priority).toBe('high');
  });
});

describe('POST /api/v1/tickets — idempotency (fix 8)', () => {
  it('2 chamadas idênticas em <60s retornam mesmo id', async () => {
    const payload = {
      customerId,
      customerName: 'API Test Cust',
      title: 'dedupe ' + Date.now(),
      category: 'internet',
      priority: 'medium' as const,
      description: 'dup',
    };
    const r1 = await app.request('/api/v1/tickets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(r1.status).toBe(201);
    const b1 = (await r1.json()) as { id: string; identifier: string };
    const r2 = await app.request('/api/v1/tickets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(r2.status).toBe(200); // dedupe = 200, não 201
    const b2 = (await r2.json()) as { id: string; identifier: string };
    expect(b2.id).toBe(b1.id);
    expect(b2.identifier).toBe(b1.identifier);
  });
});

describe('POST /api/v1/handoffs', () => {
  it('marca conversation com humanTakeoverAt + sentiment correto', async () => {
    const r = await app.request('/api/v1/handoffs', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId,
        customerId,
        customerName: 'API Test Cust',
        customerPhone: phone,
        customerPlan: 'Test',
        sentiment: 'urgente',
        resumo: 'integration test handoff',
        lastMessages: [],
      }),
    });
    expect(r.status).toBe(201);
    const [convo] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
    expect(convo?.lastSentiment).toBe('urgente');
    expect(convo?.humanTakeoverAt).toBeTruthy();
  });

  it('PATCH /:id/resolve limpa humanTakeoverAt sem forçar satisfeito (fix 3)', async () => {
    const r = await app.request(`/api/v1/handoffs/${conversationId}/resolve`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(r.status).toBe(200);
    const [convo] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
    expect(convo?.humanTakeoverAt).toBeNull();
    expect(convo?.lastSentiment).not.toBe('satisfeito');
  });
});
