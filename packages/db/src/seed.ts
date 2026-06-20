import { sql } from 'drizzle-orm';
import { createDb, customers, bills, plans } from './index.ts';

const url = process.env.KHAL_DATABASE_URL ?? 'postgresql://postgres@localhost:8432/omni';
const db = createDb(url);

// ─── 1. Planos padrão da Onyx ───
const PLANS = [
  { name: 'Light 20GB', monthlyValueCents: 5990, dataAllowanceGb: 20 },
  { name: 'Pro 50GB', monthlyValueCents: 8990, dataAllowanceGb: 50 },
  { name: 'Premium 100GB', monthlyValueCents: 12990, dataAllowanceGb: 100 },
];

console.log('seed: upsert 3 planos...');
for (const p of PLANS) {
  await db.execute(sql`
    INSERT INTO khal.plans (name, monthly_value_cents, data_allowance_gb)
    VALUES (${p.name}, ${p.monthlyValueCents}, ${p.dataAllowanceGb})
    ON CONFLICT (name) DO UPDATE SET
      monthly_value_cents = EXCLUDED.monthly_value_cents,
      data_allowance_gb = EXCLUDED.data_allowance_gb
  `);
}
const seededPlans = await db.select().from(plans);
console.log(`seed: ${seededPlans.length} planos no DB`);

// ─── 2. Backfill plan_id em customers existentes ───
const backfill = await db.execute(sql`
  UPDATE khal.customers c
  SET plan_id = p.id
  FROM khal.plans p
  WHERE c.plan_id IS NULL AND c.plan = p.name
  RETURNING c.id
`);
console.log(`seed: backfill plan_id em ${backfill.length} cliente(s)`);

// ─── 3. Inserir clientes (só se DB estiver vazio) ───
const existing = await db.select().from(customers);
if (existing.length === 0) {
  console.log('seed: DB vazio — inserindo 5 clientes mockados...');
  const planByName = Object.fromEntries(seededPlans.map((p) => [p.name, p.id]));
  const SEED = [
    { phone: '+5511999990001', name: 'João Silva', planName: 'Pro 50GB', dataUsedGb: 32, address: 'Rua das Flores, 123', cep: '01310100', numero: '123' },
    { phone: '+5511999990002', name: 'Maria Costa', planName: 'Light 20GB', dataUsedGb: 8, address: 'Av. Paulista, 456', cep: '01310200', numero: '456' },
    { phone: '+5511999990003', name: 'Carlos Mendes', planName: 'Pro 50GB', dataUsedGb: 47, address: 'Rua Augusta, 789', cep: '01304001', numero: '789' },
    { phone: '+5511999990004', name: 'Ana Oliveira', planName: 'Premium 100GB', dataUsedGb: 65, address: 'Rua Oscar Freire, 321', cep: '01426001', numero: '321' },
    { phone: '+5511999990005', name: 'Pedro Souza', planName: 'Light 20GB', dataUsedGb: 19, address: 'Av. Brigadeiro Faria Lima, 1500', cep: '04538132', numero: '1500' },
  ];

  const inserted = await db
    .insert(customers)
    .values(
      SEED.map((s) => {
        const plan = seededPlans.find((p) => p.name === s.planName);
        if (!plan) throw new Error(`Plano ${s.planName} não seedado`);
        return {
          phone: s.phone,
          name: s.name,
          plan: s.planName,
          planId: plan.id,
          monthlyValue: plan.monthlyValueCents,
          dataAllowanceGb: plan.dataAllowanceGb,
          dataUsedGb: s.dataUsedGb,
          address: s.address,
          cep: s.cep,
          numero: s.numero,
        };
      }),
    )
    .returning();
  console.log(`seed: ${inserted.length} clientes inseridos`);

  const now = new Date();
  const billRows = inserted.flatMap((c, idx) => {
    const dueOffsetDays = [3, 15, -2, 7, 1][idx] ?? 5;
    const due = new Date(now);
    due.setDate(due.getDate() + dueOffsetDays);
    return [
      {
        customerId: c.id,
        referenceMonth: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
        amountCents: c.monthlyValue,
        dueDate: due,
        status: (dueOffsetDays < 0 ? 'overdue' : 'open') as 'open' | 'overdue',
      },
    ];
  });
  await db.insert(bills).values(billRows);
  console.log(`seed: ${billRows.length} faturas inseridas`);
} else {
  console.log(`seed: ${existing.length} clientes já existem — pulei inserção (só fiz backfill plan_id)`);
}

console.log('seed: ok');
process.exit(0);
