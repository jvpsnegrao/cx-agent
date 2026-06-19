import { and, eq, gte } from 'drizzle-orm';
import { auditLog, bills } from '@khal/db';
import type { DbClient } from '../db/client.ts';

export async function gerarSegundaVia(db: DbClient, customerId: string, billId: string) {
  const [bill] = await db
    .select()
    .from(bills)
    .where(and(eq(bills.id, billId), eq(bills.customerId, customerId)))
    .limit(1);
  if (!bill) throw new Error(`fatura ${billId} não encontrada pro cliente ${customerId}`);

  const pdfUrl = `https://onyx.tel/fatura/${bill.id}.pdf`;
  await db.update(bills).set({ pdfUrl }).where(eq(bills.id, bill.id));
  await db.insert(auditLog).values({
    customerId,
    action: 'segunda_via_fatura',
    payload: { billId, pdfUrl },
    result: 'ok',
  });
  return { pdfUrl, amountCents: bill.amountCents, dueDate: bill.dueDate, referenceMonth: bill.referenceMonth };
}

export async function listarFaturasVencendoEm(db: DbClient, days: number) {
  const target = new Date();
  target.setDate(target.getDate() + days);
  const lowerBound = new Date(target);
  lowerBound.setHours(0, 0, 0, 0);
  const upperBound = new Date(target);
  upperBound.setHours(23, 59, 59, 999);
  return db
    .select()
    .from(bills)
    .where(and(gte(bills.dueDate, lowerBound), eq(bills.status, 'open')));
}
