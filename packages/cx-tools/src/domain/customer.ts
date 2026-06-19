import { eq } from 'drizzle-orm';
import { bills, customers } from '@khal/db';
import type { DbClient } from '../db/client.ts';

export type CustomerSummary = {
  id: string;
  name: string;
  plan: string;
  monthlyValue: number;
  dataAllowanceGb: number;
  dataUsedGb: number;
  status: 'active' | 'suspended' | 'cancelled';
  nextBill: {
    referenceMonth: string;
    amountCents: number;
    dueDate: Date;
    status: 'open' | 'paid' | 'overdue';
  } | null;
};

export async function findCustomerByPhone(db: DbClient, phone: string) {
  const rows = await db.select().from(customers).where(eq(customers.phone, phone)).limit(1);
  return rows[0] ?? null;
}

export async function buildCustomerSummary(db: DbClient, phone: string): Promise<CustomerSummary | null> {
  const customer = await findCustomerByPhone(db, phone);
  if (!customer) return null;

  const billRows = await db
    .select()
    .from(bills)
    .where(eq(bills.customerId, customer.id))
    .orderBy(bills.dueDate)
    .limit(1);

  const next = billRows[0];

  return {
    id: customer.id,
    name: customer.name,
    plan: customer.plan,
    monthlyValue: customer.monthlyValue,
    dataAllowanceGb: customer.dataAllowanceGb,
    dataUsedGb: customer.dataUsedGb,
    status: customer.status,
    nextBill: next
      ? {
          referenceMonth: next.referenceMonth,
          amountCents: next.amountCents,
          dueDate: next.dueDate,
          status: next.status,
        }
      : null,
  };
}

export function formatCustomerSummary(s: CustomerSummary): string {
  const monthly = (s.monthlyValue / 100).toFixed(2).replace('.', ',');
  const lines = [
    `Cliente: ${s.name}`,
    `Plano: ${s.plan} (R$ ${monthly}/mês)`,
    `Consumo: ${s.dataUsedGb}GB de ${s.dataAllowanceGb}GB`,
    `Status da conta: ${s.status}`,
  ];
  if (s.nextBill) {
    const due = s.nextBill.dueDate.toLocaleDateString('pt-BR');
    const amount = (s.nextBill.amountCents / 100).toFixed(2).replace('.', ',');
    lines.push(`Próxima fatura: R$ ${amount}, vence ${due} (${s.nextBill.status})`);
  }
  return lines.join('\n');
}
