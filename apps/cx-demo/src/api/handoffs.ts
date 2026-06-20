import { Hono } from 'hono';
import { desc, eq, isNotNull } from 'drizzle-orm';
import { auditLog, conversations, customers } from '@khal/db';
import { db } from '../db.ts';
import { requireBearer } from '../auth.ts';
import { emitStream } from '../events.ts';
import type { HandoffCreateInput, Sentiment } from '../types.ts';

const VALID_SENTIMENT: Sentiment[] = ['neutro', 'frustrado', 'satisfeito', 'urgente'];

export const handoffsApi = new Hono();

handoffsApi.use('*', requireBearer);

handoffsApi.post('/', async (c) => {
  const body = (await c.req.json()) as Partial<HandoffCreateInput>;
  if (!body.conversationId || !body.customerId || !body.sentiment || !body.resumo) {
    return c.json({ error: 'missing required fields' }, 400);
  }
  if (!VALID_SENTIMENT.includes(body.sentiment as Sentiment)) {
    return c.json({ error: 'invalid sentiment' }, 400);
  }

  const [convo] = await db
    .update(conversations)
    .set({ humanTakeoverAt: new Date(), lastSentiment: body.sentiment as Sentiment })
    .where(eq(conversations.id, body.conversationId))
    .returning();
  if (!convo) return c.json({ error: 'conversation not found' }, 404);

  await db.insert(auditLog).values({
    customerId: body.customerId,
    action: 'escalar_atendente',
    payload: {
      conversationId: body.conversationId,
      sentiment: body.sentiment,
      resumo: body.resumo,
      ticketLinearId: body.ticketLinearId,
      lastMessages: body.lastMessages ?? [],
    },
    result: 'ok',
  });

  emitStream({
    type: 'handoff_opened',
    conversationId: convo.id,
    customerName: body.customerName ?? '—',
    sentiment: body.sentiment as Sentiment,
  });

  return c.json({ ok: true, conversationId: convo.id }, 201);
});

handoffsApi.get('/', async (c) => {
  const rows = await db
    .select({
      conversationId: conversations.id,
      customerId: conversations.customerId,
      customerName: customers.name,
      customerPhone: customers.phone,
      customerPlan: customers.plan,
      sentiment: conversations.lastSentiment,
      humanTakeoverAt: conversations.humanTakeoverAt,
      startedAt: conversations.startedAt,
    })
    .from(conversations)
    .innerJoin(customers, eq(customers.id, conversations.customerId))
    .where(isNotNull(conversations.humanTakeoverAt))
    .orderBy(desc(conversations.humanTakeoverAt))
    .limit(50);
  return c.json(rows);
});

handoffsApi.patch('/:id/claim', async (c) => {
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as { claimedBy?: string };
  const claimedBy = body.claimedBy ?? 'Atendente CX';
  const [convo] = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
  if (!convo) return c.json({ error: 'conversation not found' }, 404);

  await db.insert(auditLog).values({
    customerId: convo.customerId,
    action: 'handoff_claimed',
    payload: { conversationId: id, claimedBy },
    result: 'ok',
  });

  emitStream({ type: 'handoff_claimed', conversationId: id, claimedBy });
  return c.json({ ok: true, claimedBy }, 200);
});

handoffsApi.patch('/:id/resolve', async (c) => {
  const id = c.req.param('id');
  const [convo] = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
  if (!convo) return c.json({ error: 'conversation not found' }, 404);

  // Limpa só humanTakeoverAt — sentiment é recomputado da realidade das msgs,
  // não forçado pra "satisfeito" que mente quando cliente segue irritado.
  await db
    .update(conversations)
    .set({ humanTakeoverAt: null })
    .where(eq(conversations.id, id));

  await db.insert(auditLog).values({
    customerId: convo.customerId,
    action: 'handoff_resolved',
    payload: { conversationId: id },
    result: 'ok',
  });

  emitStream({ type: 'handoff_resolved', conversationId: id });
  return c.json({ ok: true }, 200);
});
