import { eq } from 'drizzle-orm';
import { auditLog, bills, conversations, customers, plans } from '@khal/db';
import type { DbClient } from '../db/client.ts';
import type { TicketBackend } from './ticket.ts';

export type OnboardingInput = {
  phone: string;
  nome: string;
  planoId: string;
  cep: string;
  numero: string;
  complemento?: string;
};

export type OnboardingResult = {
  customerId: string;
  identifier: string;
  planName: string;
  monthlyValueCents: number;
  enderecoCompleto: string;
  primeiraFaturaDueDate: Date;
};

const FIRST_BILL_DAYS = 10;

export type ViaCepResult = {
  logradouro: string;
  bairro: string;
  localidade: string;
  uf: string;
  cep: string;
};

/**
 * Valida CEP via ViaCEP. Retorna endereço estruturado ou null se CEP inválido.
 * Aceita `fetch` injetado pra facilitar testes (default: fetch global).
 */
export async function fetchViaCep(
  cep: string,
  fetcher: typeof fetch = fetch,
): Promise<ViaCepResult | null> {
  const digits = cep.replace(/[^0-9]/g, '');
  if (digits.length !== 8) return null;
  try {
    const r = await fetcher(`https://viacep.com.br/ws/${digits}/json/`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { erro?: boolean } & ViaCepResult;
    if (data.erro) return null;
    return {
      logradouro: data.logradouro ?? '',
      bairro: data.bairro ?? '',
      localidade: data.localidade ?? '',
      uf: data.uf ?? '',
      cep: digits,
    };
  } catch {
    return null;
  }
}

/**
 * Cria cliente novo + abre ticket de instalação numa transação lógica.
 * Disparada pela Nova após onboarding completo no WhatsApp.
 */
export async function createCustomerWithInstallTicket(
  db: DbClient,
  cxDemo: TicketBackend,
  input: OnboardingInput,
  fetcher: typeof fetch = fetch,
): Promise<OnboardingResult> {
  const [plan] = await db.select().from(plans).where(eq(plans.id, input.planoId)).limit(1);
  if (!plan) throw new Error(`Plano ${input.planoId} não encontrado`);

  // Cliente existente: aceita 'prospect' (placeholder de conversa) → vai virar 'active'.
  // Qualquer outro status (active/suspended/cancelled) já é cliente real → bloqueia.
  const existing = await db
    .select()
    .from(customers)
    .where(eq(customers.phone, input.phone))
    .limit(1);
  if (existing[0] && existing[0].status !== 'prospect') {
    throw new Error(`DUPLICATE_PHONE: já existe cliente cadastrado com ${input.phone}`);
  }

  // Valida CEP via ViaCEP (fonte da verdade do endereço)
  const cepData = await fetchViaCep(input.cep, fetcher);
  if (!cepData) {
    throw new Error(`INVALID_CEP: CEP ${input.cep} não foi reconhecido pelo ViaCEP`);
  }

  const addressComposed = `${cepData.logradouro}, ${input.numero}${input.complemento ? `, ${input.complemento}` : ''} — ${cepData.bairro}, ${cepData.localidade}/${cepData.uf} · CEP ${cepData.cep}`;

  const values = {
    phone: input.phone,
    name: input.nome,
    plan: plan.name,
    planId: plan.id,
    monthlyValue: plan.monthlyValueCents,
    dataAllowanceGb: plan.dataAllowanceGb,
    dataUsedGb: 0,
    address: addressComposed,
    cep: input.cep,
    numero: input.numero,
    complemento: input.complemento ?? null,
    status: 'active' as const,
  };

  let customer;
  if (existing[0]) {
    // UPDATE prospect → active
    [customer] = await db
      .update(customers)
      .set(values)
      .where(eq(customers.id, existing[0].id))
      .returning();
  } else {
    [customer] = await db.insert(customers).values(values).returning();
  }
  if (!customer) throw new Error('falha ao inserir/atualizar customer');

  await db.insert(conversations).values({ customerId: customer.id });

  // Primeira cobrança: vencimento em +10 dias do cadastro (configurável).
  const dueDate = new Date(Date.now() + FIRST_BILL_DAYS * 24 * 60 * 60 * 1000);
  const referenceMonth = `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, '0')}`;
  await db.insert(bills).values({
    customerId: customer.id,
    referenceMonth,
    amountCents: plan.monthlyValueCents,
    dueDate,
    status: 'open',
  });

  const description = [
    `Cliente novo cadastrado via WhatsApp.`,
    ``,
    `Nome: ${input.nome}`,
    `Telefone: ${input.phone}`,
    `Plano contratado: ${plan.name} (R$ ${(plan.monthlyValueCents / 100).toFixed(2).replace('.', ',')}/mês)`,
    `Endereço (validado ViaCEP): ${addressComposed}`,
    ``,
    `Ação: equipe técnica deve entrar em contato em até 24h pra agendar a instalação.`,
  ].join('\n');

  const issue = await cxDemo.createIssue({
    customerId: customer.id,
    customerName: customer.name,
    title: `Instalação Onyx — ${input.nome}`,
    category: 'instalacao',
    priority: 'high',
    description,
  });

  await db.insert(auditLog).values({
    customerId: customer.id,
    action: 'criar_cliente',
    payload: {
      phone: input.phone,
      planoId: input.planoId,
      planName: plan.name,
      ticketIdentifier: issue.identifier,
    },
    result: 'ok',
  });

  return {
    customerId: customer.id,
    identifier: issue.identifier,
    planName: plan.name,
    monthlyValueCents: plan.monthlyValueCents,
    enderecoCompleto: addressComposed,
    primeiraFaturaDueDate: dueDate,
  };
}
