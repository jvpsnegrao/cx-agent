import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { bills, customers, auditLog } from '@khal/db';
import { db } from '../db.ts';
import { requireBearer } from '../auth.ts';
import { generateBoleto } from '../pdf.ts';
import { notifyCustomerMedia } from '../notify.ts';
import { env } from '../env.ts';

export const billsApi = new Hono();

billsApi.use('*', requireBearer);

/**
 * POST /api/v1/bills/:id/send-pdf — Chamado pelo MCP server quando cliente pede 2ª via.
 * Envia PDF representativo como anexo no WhatsApp (sem precisar link).
 * Resposta rápida (não aguarda Omni); falha vira audit_log.
 */
billsApi.post('/:id/send-pdf', async (c) => {
  const id = c.req.param('id');
  const [bill] = await db.select().from(bills).where(eq(bills.id, id)).limit(1);
  if (!bill) return c.json({ error: 'bill não encontrada' }, 404);

  const [cust] = await db.select().from(customers).where(eq(customers.id, bill.customerId)).limit(1);
  if (!cust) return c.json({ error: 'customer não encontrado' }, 404);

  // Gera PDF inline e manda como base64 (mais confiável que URL — Baileys
  // flaky downloading from localhost às vezes).
  const pdfBytes = await generateBoleto({
    identifier: bill.id.slice(0, 8),
    customerName: cust.name,
    customerPhone: cust.phone,
    customerAddress: cust.address,
    plan: cust.plan,
    referenceMonth: bill.referenceMonth,
    amountCents: bill.amountCents,
    dueDate: bill.dueDate,
  });
  const base64 = Buffer.from(pdfBytes).toString('base64');

  const caption = `2a via demonstrativa - Onyx Telecom\nRef ${bill.referenceMonth} · R$ ${(bill.amountCents / 100).toFixed(2).replace('.', ',')} · vence ${new Date(bill.dueDate).toLocaleDateString('pt-BR')}`;
  const safeName = cust.name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(' ')[0]
    ?.toLowerCase()
    ?.replace(/[^a-z0-9]/g, '') ?? 'fatura';
  const filename = `onyx-${bill.referenceMonth}-${safeName}.pdf`;

  // Fire-and-forget (latency-friendly)
  notifyCustomerMedia({
    phone: cust.phone,
    type: 'document',
    base64,
    filename,
    caption,
    mimeType: 'application/pdf',
  })
    .then(async (r) => {
      if (!r.ok) {
        await db.insert(auditLog).values({
          customerId: cust.id,
          action: 'notify_failed',
          payload: { billId: id, error: r.error, filename },
          result: 'error',
        });
      }
    })
    .catch((err) => console.error('[bills/send-pdf] notify error', err));

  return c.json({ ok: true, filename, size: pdfBytes.length });
});
