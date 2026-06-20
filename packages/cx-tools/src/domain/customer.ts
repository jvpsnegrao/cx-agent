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
  status: 'active' | 'suspended' | 'cancelled' | 'prospect';
  nextBill: {
    referenceMonth: string;
    amountCents: number;
    dueDate: Date;
    status: 'open' | 'paid' | 'overdue';
  } | null;
};

/**
 * Match flexível BR: clientes podem estar cadastrados com OU sem o "9" do celular
 * (formato antigo `+5511XXXXYYYY` vs novo `+55119XXXXYYYY`). Resolve a discrepância
 * canonical_id do Omni vs cadastro humano.
 */
function brVariant(phone: string): string | null {
  const digits = phone.replace(/[^0-9]/g, '');
  if (!digits.startsWith('55') || digits.length < 12 || digits.length > 13) return null;
  if (digits.length === 13) return `+${digits.slice(0, 4)}${digits.slice(5)}`; // tira 9 (pos 4)
  return `+${digits.slice(0, 4)}9${digits.slice(4)}`; // 12 → injeta 9
}

export async function findCustomerByPhone(db: DbClient, phone: string) {
  if (!phone) return null;
  const rows = await db.select().from(customers).where(eq(customers.phone, phone)).limit(1);
  if (rows[0]) return rows[0];
  const variant = brVariant(phone);
  if (variant && variant !== phone) {
    const rows2 = await db.select().from(customers).where(eq(customers.phone, variant)).limit(1);
    return rows2[0] ?? null;
  }
  return null;
}

export async function buildCustomerSummary(db: DbClient, phone: string): Promise<CustomerSummary | null> {
  const customer = await findCustomerByPhone(db, phone);
  if (!customer) return null;
  // prospect = customer placeholder criado pelo cx-demo p/ exibir conversa no painel.
  // Pra Nova é como se não existisse — ela vai conduzir onboarding via criar_cliente.
  if (customer.status === 'prospect') return null;

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
