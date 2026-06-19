import { describe, expect, it } from 'bun:test';
import { formatCustomerSummary } from '../src/domain/customer.ts';

describe('formatCustomerSummary', () => {
  it('renderiza resumo do cliente com fatura', () => {
    const text = formatCustomerSummary({
      id: '1',
      name: 'João Silva',
      plan: 'Pro 50GB',
      monthlyValue: 8990,
      dataAllowanceGb: 50,
      dataUsedGb: 32,
      status: 'active',
      nextBill: {
        referenceMonth: '2026-06',
        amountCents: 8990,
        dueDate: new Date('2026-06-22T00:00:00Z'),
        status: 'open',
      },
    });
    expect(text).toContain('João Silva');
    expect(text).toContain('Pro 50GB (R$ 89,90/mês)');
    expect(text).toContain('Consumo: 32GB de 50GB');
    expect(text).toContain('R$ 89,90');
  });

  it('omite linha de fatura quando não existe', () => {
    const text = formatCustomerSummary({
      id: '1',
      name: 'Ana',
      plan: 'Light 20GB',
      monthlyValue: 5990,
      dataAllowanceGb: 20,
      dataUsedGb: 5,
      status: 'active',
      nextBill: null,
    });
    expect(text).not.toContain('Próxima fatura');
  });
});
