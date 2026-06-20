import { describe, expect, it } from 'bun:test';
import { generateBoleto } from '../src/pdf.ts';

describe('generateBoleto', () => {
  it('produz bytes válidos de PDF', async () => {
    const bytes = await generateBoleto({
      identifier: 'abc12345',
      customerName: 'João Silva',
      customerPhone: '+5511999990001',
      customerAddress: 'Rua Test, 100',
      plan: 'Pro 50GB',
      referenceMonth: '2026-06',
      amountCents: 8990,
      dueDate: new Date('2026-06-15T00:00:00Z'),
    });
    expect(bytes.length).toBeGreaterThan(1000);
    // PDF magic bytes: %PDF (0x25 0x50 0x44 0x46)
    expect(bytes[0]).toBe(0x25);
    expect(bytes[1]).toBe(0x50);
    expect(bytes[2]).toBe(0x44);
    expect(bytes[3]).toBe(0x46);
  });

  it('cliente com acentos PT-BR não quebra a geração', async () => {
    const bytes = await generateBoleto({
      identifier: 'def67890',
      customerName: 'Carlos Mendes Açaí',
      customerPhone: '+5511999990003',
      customerAddress: 'Av. das Nações, São Paulo',
      plan: 'Light 20GB',
      referenceMonth: '2026-05',
      amountCents: 5990,
      dueDate: new Date('2026-05-10T00:00:00Z'),
    });
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it('valor zero não quebra', async () => {
    const bytes = await generateBoleto({
      identifier: 'zero',
      customerName: 'Z',
      customerPhone: '+550000000000',
      customerAddress: '—',
      plan: 'Free',
      referenceMonth: '2026-01',
      amountCents: 0,
      dueDate: new Date('2026-01-01T00:00:00Z'),
    });
    expect(bytes.length).toBeGreaterThan(800);
  });
});
