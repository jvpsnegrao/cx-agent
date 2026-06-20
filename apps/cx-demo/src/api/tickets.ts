import { Hono } from 'hono';
import { and, count, desc, eq, gte, sql } from 'drizzle-orm';
import { auditLog, tickets } from '@khal/db';
import { db } from '../db.ts';
import { requireBearer } from '../auth.ts';
import { emitStream } from '../events.ts';
import type { TicketCreateInput, TicketCreateResponse, TicketPriority } from '../types.ts';

const VALID_PRIORITIES: TicketPriority[] = ['low', 'medium', 'high', 'urgent'];
const DEDUPE_WINDOW_MS = 60_000;

export const ticketsApi = new Hono();

ticketsApi.use('*', requireBearer);

ticketsApi.post('/', async (c) => {
  const body = (await c.req.json()) as Partial<TicketCreateInput>;
  if (!body.customerId || !body.title || !body.category || !body.description) {
    return c.json({ error: 'missing required fields' }, 400);
  }
  const priority: TicketPriority = VALID_PRIORITIES.includes(body.priority as TicketPriority)
    ? (body.priority as TicketPriority)
    : 'medium';

  // Idempotency: Nova pode chamar abrir_ticket 2x se MCP/Genie retry.
  // Se ticket idêntico (customer+title+category) foi criado nos últimos 60s, retorna ele.
  const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
  const [existing] = await db
    .select()
    .from(tickets)
    .where(
      and(
        eq(tickets.customerId, body.customerId),
        eq(tickets.title, body.title),
        eq(tickets.category, body.category),
        gte(tickets.createdAt, since),
      ),
    )
    .orderBy(desc(tickets.createdAt))
    .limit(1);

  if (existing && existing.externalId) {
    const res: TicketCreateResponse = { id: existing.id, identifier: existing.externalId };
    return c.json(res, 200); // 200 OK (não 201) sinaliza dedupe
  }

  const [{ value: seq }] = await db
    .select({ value: count() })
    .from(tickets);
  const identifier = `ONYX-${(seq ?? 0) + 1}`;

  const [row] = await db
    .insert(tickets)
    .values({
      customerId: body.customerId,
      externalId: identifier,
      title: body.title,
      category: body.category,
      priority,
      description: body.description,
    })
    .returning();

  if (!row) return c.json({ error: 'failed to insert' }, 500);

  await db.insert(auditLog).values({
    customerId: body.customerId,
    action: 'abrir_ticket',
    payload: { identifier, title: body.title, priority },
    result: 'ok',
  });

  emitStream({
    type: 'ticket_created',
    ticketId: row.id,
    identifier,
    customerName: body.customerName ?? '—',
    title: body.title,
  });

  const res: TicketCreateResponse = { id: row.id, identifier };
  return c.json(res, 201);
});

ticketsApi.get('/', async (c) => {
  const rows = await db
    .select()
    .from(tickets)
    .orderBy(desc(tickets.createdAt))
    .limit(100);
  return c.json(rows);
});

ticketsApi.get('/:id', async (c) => {
  const id = c.req.param('id');
  const [row] = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json(row);
});

ticketsApi.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = (await c.req.json()) as { status?: string; priority?: string };
  const updates: Record<string, unknown> = {};
  if (body.status) updates.status = body.status;
  if (body.priority) updates.priority = body.priority;
  if (Object.keys(updates).length === 0) return c.json({ error: 'no updates' }, 400);

  const [row] = await db
    .update(tickets)
    .set(updates)
    .where(eq(tickets.id, id))
    .returning();
  if (!row) return c.json({ error: 'not found' }, 404);

  await db.insert(auditLog).values({
    customerId: row.customerId,
    action: 'ticket_updated',
    payload: { ticketId: id, updates },
    result: 'ok',
  });

  emitStream({ type: 'ticket_updated', ticketId: id, status: row.status });

  return c.json(row);
});
