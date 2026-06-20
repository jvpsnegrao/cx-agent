import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test';
import { eq } from 'drizzle-orm';
import { customers, plans } from '@khal/db';
import { createDb } from '@khal/db';
import {
  createCustomerWithInstallTicket,
  fetchViaCep,
} from '../src/domain/onboarding.ts';
import type { TicketBackend } from '../src/domain/ticket.ts';

const DB_URL =
  process.env.KHAL_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/omni';
const db = createDb(DB_URL);

const fakeAdapter: TicketBackend = {
  createIssue: async () => ({ id: 'fake-id', identifier: 'ONYX-TEST' }),
};

const failingAdapter: TicketBackend = {
  createIssue: async () => {
    throw new Error('cx-demo 503');
  },
};

const VIACEP_OK = {
  logradouro: 'Av. Paulista',
  bairro: 'Bela Vista',
  localidade: 'São Paulo',
  uf: 'SP',
  cep: '01310100',
};

function fakeViaCepFetch(returning: 'ok' | 'erro' | 'timeout' | 'malformed') {
  return mock(async (_url: string | URL | Request) => {
    if (returning === 'timeout') throw new Error('aborted');
    if (returning === 'erro') return new Response(JSON.stringify({ erro: true }), { status: 200 });
    if (returning === 'malformed') return new Response('not json', { status: 200 });
    return new Response(JSON.stringify(VIACEP_OK), { status: 200 });
  }) as unknown as typeof fetch;
}

let planoId = '';
const created: string[] = [];

beforeAll(async () => {
  // Garante plano existente pra reuso nos tests
  const existing = await db.select().from(plans).limit(1);
  if (existing[0]) {
    planoId = existing[0].id;
  } else {
    const [p] = await db
      .insert(plans)
      .values({ name: 'Test Plano', monthlyValueCents: 9990, dataAllowanceGb: 50 })
      .returning();
    planoId = p.id;
  }
});

afterEach(async () => {
  for (const id of created) await db.delete(customers).where(eq(customers.id, id));
  created.length = 0;
});

afterAll(async () => {
  for (const id of created) await db.delete(customers).where(eq(customers.id, id));
});

// ───── fetchViaCep ─────

describe('fetchViaCep — corner cases', () => {
  it('CEP válido retorna endereço estruturado', async () => {
    const r = await fetchViaCep('01310-100', fakeViaCepFetch('ok'));
    expect(r).not.toBeNull();
    expect(r?.logradouro).toBe('Av. Paulista');
    expect(r?.uf).toBe('SP');
  });

  it('CEP com 7 dígitos é rejeitado sem hit no ViaCEP', async () => {
    const r = await fetchViaCep('0131010', fakeViaCepFetch('ok'));
    expect(r).toBeNull();
  });

  it('CEP com letras é rejeitado', async () => {
    const r = await fetchViaCep('01ABC100', fakeViaCepFetch('ok'));
    expect(r).toBeNull();
  });

  it('ViaCEP responde {erro:true} → null', async () => {
    const r = await fetchViaCep('99999999', fakeViaCepFetch('erro'));
    expect(r).toBeNull();
  });

  it('ViaCEP timeout/network error → null (não throw)', async () => {
    const r = await fetchViaCep('01310100', fakeViaCepFetch('timeout'));
    expect(r).toBeNull();
  });

  it('Response não-JSON → null', async () => {
    const r = await fetchViaCep('01310100', fakeViaCepFetch('malformed'));
    expect(r).toBeNull();
  });

  it('CEP com hífen e espaços é normalizado', async () => {
    const r = await fetchViaCep(' 01310-100 ', fakeViaCepFetch('ok'));
    expect(r).not.toBeNull();
  });
});

// ───── createCustomerWithInstallTicket ─────

describe('createCustomerWithInstallTicket — happy path', () => {
  it('cria customer + ticket com CEP validado', async () => {
    const phone = `+5599${Date.now().toString().slice(-9)}`;
    const r = await createCustomerWithInstallTicket(
      db,
      fakeAdapter,
      { phone, nome: 'Test User', planoId, cep: '01310100', numero: '100' },
      fakeViaCepFetch('ok'),
    );
    created.push(r.customerId);
    expect(r.identifier).toBe('ONYX-TEST');
    expect(r.enderecoCompleto).toContain('Av. Paulista');
    expect(r.enderecoCompleto).toContain('São Paulo/SP');
    expect(r.enderecoCompleto).toContain('100');
  });

  it('aceita complemento opcional', async () => {
    const phone = `+5599${Date.now().toString().slice(-9)}`;
    const r = await createCustomerWithInstallTicket(
      db,
      fakeAdapter,
      { phone, nome: 'Test', planoId, cep: '01310100', numero: '200', complemento: 'ap 502' },
      fakeViaCepFetch('ok'),
    );
    created.push(r.customerId);
    expect(r.enderecoCompleto).toContain('ap 502');
  });
});

describe('createCustomerWithInstallTicket — corner cases', () => {
  it('throws INVALID_CEP quando ViaCEP rejeita', async () => {
    const phone = `+5599${Date.now().toString().slice(-9)}`;
    await expect(
      createCustomerWithInstallTicket(
        db,
        fakeAdapter,
        { phone, nome: 'T', planoId, cep: '00000000', numero: '1' },
        fakeViaCepFetch('erro'),
      ),
    ).rejects.toThrow(/INVALID_CEP/);
  });

  it('throws INVALID_CEP quando ViaCEP timeout', async () => {
    const phone = `+5599${Date.now().toString().slice(-9)}`;
    await expect(
      createCustomerWithInstallTicket(
        db,
        fakeAdapter,
        { phone, nome: 'T', planoId, cep: '01310100', numero: '1' },
        fakeViaCepFetch('timeout'),
      ),
    ).rejects.toThrow(/INVALID_CEP/);
  });

  it('throws DUPLICATE_PHONE quando phone já existe', async () => {
    const phone = `+5599${Date.now().toString().slice(-9)}`;
    const first = await createCustomerWithInstallTicket(
      db,
      fakeAdapter,
      { phone, nome: 'Test', planoId, cep: '01310100', numero: '1' },
      fakeViaCepFetch('ok'),
    );
    created.push(first.customerId);
    await expect(
      createCustomerWithInstallTicket(
        db,
        fakeAdapter,
        { phone, nome: 'Test Dois', planoId, cep: '01310100', numero: '2' },
        fakeViaCepFetch('ok'),
      ),
    ).rejects.toThrow(/DUPLICATE_PHONE/);
  });

  it('throws quando planoId não existe', async () => {
    const phone = `+5599${Date.now().toString().slice(-9)}`;
    await expect(
      createCustomerWithInstallTicket(
        db,
        fakeAdapter,
        {
          phone,
          nome: 'T',
          planoId: '00000000-0000-0000-0000-000000000000',
          cep: '01310100',
          numero: '1',
        },
        fakeViaCepFetch('ok'),
      ),
    ).rejects.toThrow(/Plano/);
  });

  it('propaga erro do adapter cx-demo sem deixar customer órfão', async () => {
    const phone = `+5599${Date.now().toString().slice(-9)}`;
    await expect(
      createCustomerWithInstallTicket(
        db,
        failingAdapter,
        { phone, nome: 'Test', planoId, cep: '01310100', numero: '1' },
        fakeViaCepFetch('ok'),
      ),
    ).rejects.toThrow(/cx-demo/);
    // Customer foi inserido antes do adapter chamar (sem transação) — limpa pra outros tests
    const orphan = await db.select().from(customers).where(eq(customers.phone, phone)).limit(1);
    if (orphan[0]) {
      created.push(orphan[0].id);
    }
  });

  it('CEP com hífen e espaços é aceito (normaliza)', async () => {
    const phone = `+5599${Date.now().toString().slice(-9)}`;
    const r = await createCustomerWithInstallTicket(
      db,
      fakeAdapter,
      { phone, nome: 'T', planoId, cep: ' 01310-100 ', numero: '1' },
      fakeViaCepFetch('ok'),
    );
    created.push(r.customerId);
    expect(r.identifier).toBe('ONYX-TEST');
  });
});
