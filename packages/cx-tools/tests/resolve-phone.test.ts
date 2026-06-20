import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { customers } from '@khal/db';
import { createDb } from '@khal/db';
import { findCustomerByPhone } from '../src/domain/customer.ts';

const DB_URL =
  process.env.KHAL_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/omni';
const db = createDb(DB_URL);

let withNine = '';
let withoutNine = '';
let id1 = '';
let id2 = '';

beforeAll(async () => {
  // 8 dígitos pra parte local do número (DDD 11 + 8 = telefone E.164 BR válido sem 9)
  // E o COM 9 adiciona o "9" prefix → 13 dígitos total
  const r = String(Date.now()).slice(-8);
  withNine = `+5511${'9'}${r}`; // 13 digits: 55 + 11 + 9 + 8
  // Pra evitar collision (variant de withNine seria igual a withoutNine), uso DDD diferente no sem-9
  const r2 = String(Date.now() + 1).slice(-8);
  withoutNine = `+5521${r2}`; // 12 digits: 55 + 21 + 8
  const [c1] = await db
    .insert(customers)
    .values({
      phone: withNine,
      name: 'Cust Com 9',
      plan: 'T',
      monthlyValue: 0,
      dataAllowanceGb: 0,
      dataUsedGb: 0,
      address: '—',
      status: 'active',
    })
    .returning();
  id1 = c1.id;
  const [c2] = await db
    .insert(customers)
    .values({
      phone: withoutNine,
      name: 'Cust Sem 9',
      plan: 'T',
      monthlyValue: 0,
      dataAllowanceGb: 0,
      dataUsedGb: 0,
      address: '—',
      status: 'active',
    })
    .returning();
  id2 = c2.id;
});

afterAll(async () => {
  if (id1) await db.delete(customers).where(eq(customers.id, id1)).catch(() => {});
  if (id2) await db.delete(customers).where(eq(customers.id, id2)).catch(() => {});
  // safety net: limpa por name pra pegar leftovers se beforeAll falhar no meio
  await db.delete(customers).where(eq(customers.name, 'Cust Com 9')).catch(() => {});
  await db.delete(customers).where(eq(customers.name, 'Cust Sem 9')).catch(() => {});
});

describe('findCustomerByPhone — match BR flex (com/sem 9 do celular)', () => {
  it('match exato com 9', async () => {
    const r = await findCustomerByPhone(db, withNine);
    expect(r?.id).toBe(id1);
  });

  it('match exato sem 9', async () => {
    const r = await findCustomerByPhone(db, withoutNine);
    expect(r?.id).toBe(id2);
  });

  it('queryphone com 9 (formato novo) acha cliente cadastrado SEM 9 (variante BR)', async () => {
    // withoutNine = '+5521XXXXXXXX'; query com 9 inserido = '+552190XXXXXXX'? Não — brVariant
    // injeta '9' na posição 4 (depois do DDD '+5521'): '+55219' + 8 digits últimos
    const digits = withoutNine.replace(/[^0-9]/g, '');
    const withNineVariant = '+' + digits.slice(0, 4) + '9' + digits.slice(4);
    const r = await findCustomerByPhone(db, withNineVariant);
    expect(r?.id).toBe(id2);
  });

  it('queryphone sem 9 (formato antigo) acha cliente cadastrado COM 9 (variante BR)', async () => {
    // withNine = '+5511 9 XXXXXXXX'; query sem 9 = '+5511XXXXXXXX'
    const digits = withNine.replace(/[^0-9]/g, '');
    const withoutNineVariant = '+' + digits.slice(0, 4) + digits.slice(5);
    const r = await findCustomerByPhone(db, withoutNineVariant);
    expect(r?.id).toBe(id1);
  });

  it('phone vazio retorna null', async () => {
    const r = await findCustomerByPhone(db, '');
    expect(r).toBeNull();
  });

  it('phone que não existe retorna null', async () => {
    const r = await findCustomerByPhone(db, '+5599999999999');
    expect(r).toBeNull();
  });
});
