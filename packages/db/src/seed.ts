import { createDb, customers, bills } from './index.ts';

const url = process.env.KHAL_DATABASE_URL ?? 'postgresql://postgres@localhost:8432/omni';
const db = createDb(url);

const SEED_CUSTOMERS = [
  {
    phone: '+5511999990001',
    name: 'João Silva',
    plan: 'Pro 50GB',
    monthlyValue: 8990,
    dataAllowanceGb: 50,
    dataUsedGb: 32,
    address: 'Rua das Flores, 123, São Paulo/SP',
  },
  {
    phone: '+5511999990002',
    name: 'Maria Costa',
    plan: 'Light 20GB',
    monthlyValue: 5990,
    dataAllowanceGb: 20,
    dataUsedGb: 8,
    address: 'Av. Paulista, 456, São Paulo/SP',
  },
  {
    phone: '+5511999990003',
    name: 'Carlos Mendes',
    plan: 'Pro 50GB',
    monthlyValue: 8990,
    dataAllowanceGb: 50,
    dataUsedGb: 47,
    address: 'Rua Augusta, 789, São Paulo/SP',
  },
  {
    phone: '+5511999990004',
    name: 'Ana Oliveira',
    plan: 'Premium 100GB',
    monthlyValue: 12990,
    dataAllowanceGb: 100,
    dataUsedGb: 65,
    address: 'Rua Oscar Freire, 321, São Paulo/SP',
  },
  {
    phone: '+5511999990005',
    name: 'Pedro Souza',
    plan: 'Light 20GB',
    monthlyValue: 5990,
    dataAllowanceGb: 20,
    dataUsedGb: 19,
    address: 'Av. Brigadeiro Faria Lima, 1500, São Paulo/SP',
  },
];

console.log('seed: inserindo clientes...');
const inserted = await db.insert(customers).values(SEED_CUSTOMERS).returning();
console.log(`seed: ${inserted.length} clientes inseridos`);

const now = new Date();
const billRows = inserted.flatMap((c, idx) => {
  const dueOffsetDays = [3, 15, -2, 7, 1][idx] ?? 5;
  const due = new Date(now);
  due.setDate(due.getDate() + dueOffsetDays);
  const status = dueOffsetDays < 0 ? 'overdue' : 'open';
  return [
    {
      customerId: c.id,
      referenceMonth: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
      amountCents: c.monthlyValue,
      dueDate: due,
      status: status as 'open' | 'overdue',
    },
  ];
});

await db.insert(bills).values(billRows);
console.log(`seed: ${billRows.length} faturas inseridas`);
console.log('seed: ok');
process.exit(0);
