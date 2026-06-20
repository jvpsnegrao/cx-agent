import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { streamSSE } from 'hono/streaming';
import { env } from './env.ts';
import { ticketsApi } from './api/tickets.ts';
import { handoffsApi } from './api/handoffs.ts';
import { billsApi } from './api/bills.ts';
import { eq, sql } from 'drizzle-orm';
import { bills, customers } from '@khal/db';
import { db } from './db.ts';
import { generateBoleto } from './pdf.ts';
import { pages } from './routes/pages.tsx';
import { subscribeStream } from './events.ts';
import { startNatsSubscriber } from './nats.ts';
import { startOmniPoll } from './omni-poll.ts';
import { requireSession } from './auth.ts';

const app = new Hono();

app.use('*', logger());

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    service: 'cx-demo',
    time: new Date().toISOString(),
  }),
);

app.get('/events', requireSession, (c) =>
  streamSSE(c, async (stream) => {
    const unsubscribe = subscribeStream((ev) => {
      stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) }).catch(() => {
        /* client gone */
      });
    });
    stream.onAbort(() => unsubscribe());

    await stream.writeSSE({ event: 'ready', data: JSON.stringify({ ok: true }) });

    while (!c.req.raw.signal.aborted) {
      await stream.sleep(15000);
      if (c.req.raw.signal.aborted) break;
      try {
        await stream.writeSSE({ event: 'ping', data: 'pong' });
      } catch {
        break;
      }
    }
  }),
);

app.route('/api/v1/tickets', ticketsApi);
app.route('/api/v1/handoffs', handoffsApi);
app.route('/api/v1/bills', billsApi);

// PDF público (sem auth — Omni precisa baixar). Não vaza dados extras.
app.get('/bills/:id/pdf', async (c) => {
  const id = c.req.param('id');
  const [bill] = await db.select().from(bills).where(eq(bills.id, id)).limit(1);
  if (!bill) return c.text('not found', 404);
  const [cust] = await db.select().from(customers).where(eq(customers.id, bill.customerId)).limit(1);
  if (!cust) return c.text('customer not found', 404);
  const pdf = await generateBoleto({
    identifier: bill.id.slice(0, 8),
    customerName: cust.name,
    customerPhone: cust.phone,
    customerAddress: cust.address,
    plan: cust.plan,
    referenceMonth: bill.referenceMonth,
    amountCents: bill.amountCents,
    dueDate: bill.dueDate,
  });
  c.header('Content-Type', 'application/pdf');
  c.header('Content-Disposition', `inline; filename="onyx-${bill.referenceMonth}.pdf"`);
  return c.body(pdf);
});

app.route('/', pages);

// Bootstrap NATS subscriber + Omni poll.
startNatsSubscriber().catch((err) => {
  console.error('[nats] bootstrap falhou', err);
});
startOmniPoll().catch((err) => {
  console.error('[omni-poll] bootstrap falhou', err);
});

// Normaliza bills vencidos: status='overdue' onde due_date < now AND status='open'.
// Roda no boot + a cada 15min pra pegar boletos que vencem durante a sessão.
async function markOverdueBills() {
  try {
    const r = await db.execute(
      sql`UPDATE khal.bills SET status='overdue' WHERE due_date < now() AND status='open' RETURNING id`,
    );
    if (r.length > 0) console.log(`[overdue] ${r.length} boleto(s) marcado(s) como vencido`);
  } catch (err) {
    console.error('[overdue] erro', err instanceof Error ? err.message : err);
  }
}
markOverdueBills();
setInterval(markOverdueBills, 15 * 60_000);

Bun.serve({
  port: env.port,
  fetch: app.fetch,
});
console.log(`[cx-demo] listening on :${env.port}`);

export default {
  port: env.port,
  fetch: app.fetch,
};
