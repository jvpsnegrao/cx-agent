#!/usr/bin/env bun
/**
 * Lembrete proativo de fatura — dispara mensagem WhatsApp via Omni 3 dias antes do vencimento.
 *
 * Rodar manualmente: `bun packages/cx-cron/src/reminder.ts`
 * Idempotência: tabela khal.reminders_sent com (bill_id, idempotency_key).
 */
import { and, eq, gte, lte } from 'drizzle-orm';
import { bills, customers, remindersSent } from '@khal/db';
import { createDb } from '@khal/db';

const DB_URL = process.env.KHAL_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:8432/omni';
const OMNI_URL = process.env.OMNI_API_URL ?? 'http://localhost:8882';
const OMNI_KEY = process.env.OMNI_API_KEY ?? '';
const INSTANCE_ID = process.env.OMNI_INSTANCE_ID ?? '';
const DAYS_AHEAD = Number(process.env.REMINDER_DAYS_AHEAD ?? '3');

if (!OMNI_KEY || !INSTANCE_ID) {
  console.error('OMNI_API_KEY ou OMNI_INSTANCE_ID não configurados — abortando.');
  process.exit(1);
}

const db = createDb(DB_URL);

const now = new Date();
const target = new Date(now);
target.setDate(target.getDate() + DAYS_AHEAD);
const lower = new Date(target);
lower.setHours(0, 0, 0, 0);
const upper = new Date(target);
upper.setHours(23, 59, 59, 999);

const dueBills = await db
  .select({
    billId: bills.id,
    amountCents: bills.amountCents,
    dueDate: bills.dueDate,
    customerId: customers.id,
    customerName: customers.name,
    customerPhone: customers.phone,
  })
  .from(bills)
  .innerJoin(customers, eq(customers.id, bills.customerId))
  .where(and(eq(bills.status, 'open'), gte(bills.dueDate, lower), lte(bills.dueDate, upper)));

console.log(`reminder: ${dueBills.length} fatura(s) vencendo em ${DAYS_AHEAD}d`);

for (const row of dueBills) {
  const idempotencyKey = `bill:${row.billId}:T-${DAYS_AHEAD}`;
  const existing = await db.select().from(remindersSent).where(eq(remindersSent.idempotencyKey, idempotencyKey)).limit(1);
  if (existing.length > 0) {
    console.log(`reminder: skip ${row.customerPhone} (já enviado)`);
    continue;
  }

  const amount = (row.amountCents / 100).toFixed(2).replace('.', ',');
  const due = row.dueDate.toLocaleDateString('pt-BR');
  const text = [
    `Oi ${row.customerName.split(' ')[0]}, tudo bem?`,
    ``,
    `Passando pra avisar: sua fatura de R$ ${amount} vence em ${DAYS_AHEAD} dias (${due}).`,
    ``,
    `Quer que eu já te mande a 2ª via?`,
    `1 - Sim, me manda`,
    `2 - Já paguei`,
    `3 - Falar com alguém`,
  ].join('\n');

  const res = await fetch(`${OMNI_URL}/api/v2/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': OMNI_KEY },
    body: JSON.stringify({ instanceId: INSTANCE_ID, to: row.customerPhone, text }),
  });

  if (!res.ok) {
    console.error(`reminder: falha ${row.customerPhone} (${res.status}): ${await res.text()}`);
    continue;
  }

  await db.insert(remindersSent).values({ billId: row.billId, idempotencyKey });
  console.log(`reminder: enviado pra ${row.customerName} (${row.customerPhone})`);
}

console.log('reminder: done');
process.exit(0);
