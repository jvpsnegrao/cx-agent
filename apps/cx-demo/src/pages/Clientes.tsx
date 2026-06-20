import type { FC } from 'hono/jsx';
import { Shell } from './Shell.tsx';
import { StatusBadge } from '../components/SentimentBadge.tsx';

export type ClienteRow = {
  id: string;
  name: string;
  phone: string;
  plan: string;
  planId: string | null;
  monthlyValue: number;
  dataAllowanceGb: number;
  dataUsedGb: number;
  status: 'active' | 'suspended' | 'cancelled';
  address: string;
  cep: string | null;
  numero: string | null;
  complemento: string | null;
};

export type PlanRow = {
  id: string;
  name: string;
  monthlyValueCents: number;
  dataAllowanceGb: number;
};

export type BillRow = {
  id: string;
  referenceMonth: string;
  amountCents: number;
  dueDate: Date;
  status: 'open' | 'paid' | 'overdue';
  pdfUrl: string | null;
};

export type TicketRowMini = {
  id: string;
  externalId: string | null;
  title: string;
  status: string;
  createdAt: Date;
};

const reais = (cents: number) =>
  `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;

const fmtDate = (d: Date) =>
  new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

export const Clientes: FC<{
  rows: ClienteRow[];
  selectedId?: string;
  selectedRow?: ClienteRow;
  bills?: BillRow[];
  tickets?: TicketRowMini[];
  plans?: PlanRow[];
  search?: string;
}> = ({ rows, selectedId, selectedRow, bills, tickets, plans, search }) => (
  <Shell title="Clientes" activeTab="clientes">
    <div class="grid grid-cols-12 gap-4 h-[calc(100vh-7rem)]">
      <aside class="col-span-5 flex flex-col gap-3 min-h-0">
        <div class="flex items-center justify-between px-1">
          <div>
            <h2 class="text-lg font-semibold">Clientes</h2>
            <p class="text-xs text-gray-500">{rows.length} cadastrados</p>
          </div>
          <button
            type="button"
            hx-get="/partials/cliente/new"
            hx-target="#cliente-detail"
            hx-swap="innerHTML"
            class="px-3 py-1.5 text-xs bg-cyan-600 hover:bg-cyan-500 text-white rounded-md font-medium transition flex items-center gap-1.5"
          >
            <span class="text-base leading-none">+</span> Novo
          </button>
        </div>
        <input
          type="search"
          name="q"
          value={search ?? ''}
          placeholder="Buscar por nome, telefone ou plano…"
          hx-get="/partials/clientes"
          hx-trigger="input changed delay:300ms, search"
          hx-target="#clientes-list"
          hx-swap="innerHTML"
          class="w-full bg-gray-900 border border-gray-800 rounded-md px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-cyan-500 transition"
        />
        <div
          id="clientes-list"
          hx-get="/partials/clientes"
          hx-trigger="customers:changed from:body"
          hx-swap="innerHTML"
          class="flex-1 min-h-0 overflow-y-auto scrollbar-thin bg-gray-900/50 border border-gray-800 rounded-lg"
        >
          <ClientesList rows={rows} selectedId={selectedId} />
        </div>
      </aside>
      <section class="col-span-7 flex flex-col min-h-0">
        <div id="cliente-detail" class="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
          {selectedRow ? (
            <ClienteDetail row={selectedRow} bills={bills ?? []} tickets={tickets ?? []} plans={plans ?? []} />
          ) : (
            <div class="h-full bg-gray-900/30 border border-gray-800 border-dashed rounded-lg flex items-center justify-center text-gray-500 text-sm">
              ← Selecione um cliente ou clique em + Novo
            </div>
          )}
        </div>
      </section>
    </div>
  </Shell>
);

export const ClientesList: FC<{ rows: ClienteRow[]; selectedId?: string }> = ({ rows, selectedId }) => (
  <div>
    {rows.length === 0 ? (
      <div class="px-4 py-8 text-center text-gray-500 text-sm">Sem clientes. Use + Novo.</div>
    ) : (
      rows.map((c) => (
        <a
          href={`/clientes/${c.id}`}
          class={`block px-4 py-3 border-b border-gray-800/60 transition ${
            selectedId === c.id ? 'bg-cyan-500/10 border-l-2 border-l-cyan-400' : 'hover:bg-gray-800/40'
          }`}
        >
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-9 h-9 rounded-full bg-gradient-to-br from-gray-700 to-gray-800 flex items-center justify-center text-gray-300 font-semibold text-sm shrink-0">
                {c.name.slice(0, 1).toUpperCase()}
              </div>
              <div class="min-w-0">
                <div class="font-medium text-sm truncate">{c.name}</div>
                <div class="text-xs text-gray-500 font-mono truncate">{c.phone}</div>
              </div>
            </div>
            <div class="text-right shrink-0">
              <div class="text-xs text-gray-400">{c.plan}</div>
              <StatusBadge status={c.status} />
            </div>
          </div>
        </a>
      ))
    )}
  </div>
);

export const ClienteDetail: FC<{ row: ClienteRow; bills: BillRow[]; tickets: TicketRowMini[]; plans: PlanRow[] }> = ({ row, bills, tickets, plans }) => (
  <div class="bg-gray-900/50 border border-gray-800 rounded-lg p-5 space-y-5">
    <header class="flex items-start justify-between gap-4 pb-4 border-b border-gray-800">
      <div class="flex items-start gap-3 min-w-0">
        <div class="w-12 h-12 rounded-full bg-gradient-to-br from-cyan-500/20 to-cyan-700/30 flex items-center justify-center text-cyan-300 font-bold text-lg shrink-0">
          {row.name.slice(0, 1).toUpperCase()}
        </div>
        <div class="min-w-0">
          <h2 class="text-xl font-semibold truncate">{row.name}</h2>
          <div class="text-sm text-gray-400 font-mono mt-0.5">{row.phone}</div>
          <div class="text-xs text-gray-500 mt-1">{row.address}</div>
        </div>
      </div>
      <div class="flex flex-col items-end gap-2 shrink-0">
        <StatusBadge status={row.status} />
        <div class="flex gap-2 mt-1">
          <button
            type="button"
            hx-get={`/partials/cliente/${row.id}/edit`}
            hx-target="#cliente-detail"
            hx-swap="innerHTML"
            class="px-2.5 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded transition"
          >
            Editar
          </button>
          <button
            type="button"
            hx-delete={`/actions/clientes/${row.id}`}
            hx-confirm={`Excluir ${row.name}? Faturas, conversas e tickets vão junto.`}
            hx-target="#cliente-detail"
            hx-swap="innerHTML"
            class="px-2.5 py-1 text-xs bg-red-700/70 hover:bg-red-600 text-white rounded transition"
          >
            Excluir
          </button>
        </div>
      </div>
    </header>

    <section>
      <h3 class="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">Plano</h3>
      <div class="grid grid-cols-3 gap-3 text-sm">
        <div class="bg-gray-900 rounded-md px-3 py-2 border border-gray-800">
          <div class="text-[10px] uppercase text-gray-500">Plano</div>
          <div class="font-medium mt-0.5">{row.plan}</div>
        </div>
        <div class="bg-gray-900 rounded-md px-3 py-2 border border-gray-800">
          <div class="text-[10px] uppercase text-gray-500">Mensal</div>
          <div class="font-medium mt-0.5">{reais(row.monthlyValue)}</div>
        </div>
        <div class="bg-gray-900 rounded-md px-3 py-2 border border-gray-800">
          <div class="text-[10px] uppercase text-gray-500">Consumo</div>
          <div class="font-medium mt-0.5">
            {row.dataUsedGb}<span class="text-gray-500">/{row.dataAllowanceGb}GB</span>
          </div>
        </div>
      </div>
    </section>

    <section>
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-xs uppercase tracking-wider text-gray-500 font-semibold">Faturas ({bills.length})</h3>
        <button
          type="button"
          hx-get={`/partials/cliente/${row.id}/bill/new`}
          hx-target="#bills-section"
          hx-swap="afterbegin"
          class="text-xs text-cyan-400 hover:text-cyan-300 transition"
        >
          + nova fatura
        </button>
      </div>
      <div id="bills-section" class="space-y-2">
        {bills.length === 0 ? (
          <div class="text-center text-xs text-gray-500 py-4 border border-dashed border-gray-800 rounded">Sem faturas</div>
        ) : (
          bills.map((b) => (
            <div class="flex items-center justify-between bg-gray-900 rounded-md px-3 py-2 border border-gray-800">
              <div class="flex items-center gap-3">
                <span class="font-mono text-xs text-gray-400">{b.referenceMonth}</span>
                <span class="font-medium text-sm">{reais(b.amountCents)}</span>
                <span class="text-xs text-gray-500">vence {fmtDate(b.dueDate)}</span>
                <StatusBadge status={b.status} />
              </div>
              <div class="flex items-center gap-2">
                {b.pdfUrl ? (
                  <a href={b.pdfUrl} target="_blank" rel="noopener noreferrer" class="text-xs text-cyan-400 hover:underline">
                    ↗ 2ª via
                  </a>
                ) : null}
                {b.status !== 'paid' ? (
                  <button
                    type="button"
                    hx-patch={`/actions/bills/${b.id}/pay`}
                    hx-target="#bills-section"
                    hx-swap="outerHTML"
                    class="text-xs text-green-400 hover:text-green-300"
                  >
                    marcar paga
                  </button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
    </section>

    <section>
      <h3 class="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">Tickets recentes ({tickets.length})</h3>
      {tickets.length === 0 ? (
        <div class="text-center text-xs text-gray-500 py-4 border border-dashed border-gray-800 rounded">Sem tickets</div>
      ) : (
        <div class="space-y-1.5">
          {tickets.map((t) => (
            <div class="flex items-center justify-between bg-gray-900 rounded-md px-3 py-2 border border-gray-800">
              <div class="flex items-center gap-3">
                <span class="font-mono text-xs text-cyan-400">{t.externalId ?? '—'}</span>
                <span class="text-sm">{t.title}</span>
              </div>
              <div class="flex items-center gap-3">
                <StatusBadge status={t.status} />
                <span class="text-[10px] text-gray-500">{fmtDate(t.createdAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  </div>
);

// ───── Forms ─────

export const ClienteForm: FC<{
  row?: ClienteRow;
  action: string;
  title: string;
  plans: PlanRow[];
}> = ({ row, action, title, plans }) => (
  <div class="bg-gray-900/50 border border-gray-800 rounded-lg p-5">
    <h2 class="text-lg font-semibold mb-4">{title}</h2>
    <form
      hx-post={action}
      hx-target="#cliente-detail"
      hx-swap="innerHTML"
      class="space-y-3"
    >
      <FormField name="name" label="Nome" defaultValue={row?.name} required />
      <label class="block">
        <span class="text-xs uppercase text-gray-500 font-semibold tracking-wider">Telefone</span>
        <input
          name="phone"
          type="text"
          required
          maxlength="14"
          defaultValue={row?.phone ?? '+55'}
          placeholder="+5511999998877"
          oninput="(function(el){let v=el.value.replace(/[^0-9]/g,'');if(!v.startsWith('55'))v='55'+v;v=v.slice(0,13);el.value='+'+v;})(this)"
          class="mt-1 w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:border-cyan-500 transition"
        />
        <span class="text-[10px] text-gray-500 mt-1 block">formato E.164 brasileiro (+55DDXNNNNNNNN)</span>
      </label>
      <label class="block">
        <span class="text-xs uppercase text-gray-500 font-semibold tracking-wider">Plano</span>
        <select
          name="planId"
          required
          class="mt-1 w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm"
        >
          {plans.map((p) => (
            <option value={p.id} selected={row?.planId === p.id}>
              {p.name} — R$ {(p.monthlyValueCents / 100).toFixed(2).replace('.', ',')} · {p.dataAllowanceGb}GB
            </option>
          ))}
        </select>
      </label>
      <div class="space-y-2 p-3 bg-gray-800/40 border border-gray-800 rounded-md">
        <div class="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Endereço de instalação</div>
        <label class="block">
          <span class="text-xs text-gray-400">CEP</span>
          <input
            id="cliente-cep"
            name="cep"
            type="text"
            required
            maxlength="9"
            defaultValue={row?.cep ?? ''}
            placeholder="00000-000"
            class="mt-1 w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:border-cyan-500 transition"
          />
          <span id="cep-info" class="text-[10px] text-gray-500 mt-1 block min-h-[1em]" />
        </label>
        <div class="grid grid-cols-2 gap-2">
          <label class="block">
            <span class="text-xs text-gray-400">Número</span>
            <input
              name="numero"
              type="text"
              required
              defaultValue={row?.numero ?? ''}
              placeholder="123"
              class="mt-1 w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-cyan-500 transition"
            />
          </label>
          <label class="block">
            <span class="text-xs text-gray-400">Complemento</span>
            <input
              name="complemento"
              type="text"
              defaultValue={row?.complemento ?? ''}
              placeholder="ap 502 (opcional)"
              class="mt-1 w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-cyan-500 transition"
            />
          </label>
        </div>
      </div>
      <div class="block">
        <label class="text-xs uppercase text-gray-500 font-semibold tracking-wider">Status</label>
        <select name="status" class="mt-1 w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm">
          {(['active', 'suspended', 'cancelled'] as const).map((s) => (
            <option value={s} selected={row?.status === s}>{s}</option>
          ))}
        </select>
      </div>
      <div class="flex gap-2 pt-2">
        <button type="submit" class="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-md text-sm font-medium transition">
          Salvar
        </button>
        <button
          type="button"
          hx-get={row ? `/partials/cliente/${row.id}` : '/partials/cliente/empty'}
          hx-target="#cliente-detail"
          hx-swap="innerHTML"
          class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-md text-sm transition"
        >
          Cancelar
        </button>
      </div>
    </form>
    <script
      dangerouslySetInnerHTML={{
        __html: `
(function(){
  const cep = document.getElementById('cliente-cep');
  const info = document.getElementById('cep-info');
  if (!cep || !info) return;
  let timer;
  cep.addEventListener('input', function() {
    let v = cep.value.replace(/[^0-9]/g, '').slice(0, 8);
    if (v.length > 5) v = v.slice(0, 5) + '-' + v.slice(5);
    cep.value = v;
    info.textContent = '';
    clearTimeout(timer);
    const digits = v.replace(/[^0-9]/g, '');
    if (digits.length === 8) {
      timer = setTimeout(async () => {
        info.textContent = 'buscando…';
        try {
          const r = await fetch('https://viacep.com.br/ws/' + digits + '/json/');
          const data = await r.json();
          if (data.erro) {
            info.textContent = 'CEP não encontrado';
          } else {
            info.textContent = (data.logradouro || '—') + ', ' + (data.bairro || '—') + ' · ' + (data.localidade || '') + '/' + (data.uf || '');
          }
        } catch (e) {
          info.textContent = 'falha ao consultar ViaCEP';
        }
      }, 350);
    }
  });
  cep.dispatchEvent(new Event('input'));
})();
`,
      }}
    />
  </div>
);

export const BillForm: FC<{ customerId: string }> = ({ customerId }) => (
  <>
    <form
      id="bill-form"
      hx-post={`/actions/clientes/${customerId}/bills`}
      hx-target="#bills-section"
      hx-swap="outerHTML"
      class="bg-gray-800/60 border border-cyan-500/30 rounded-md p-3 space-y-2"
    >
      <div class="text-xs text-cyan-400 font-semibold uppercase tracking-wider">Nova fatura</div>
      <div class="grid grid-cols-3 gap-2">
        <label class="block">
          <span class="text-[10px] text-gray-400 block mb-0.5">Referência (YYYY-MM)</span>
          <input
            id="bill-ref"
            name="referenceMonth"
            type="text"
            required
            maxlength="7"
            placeholder="2026-07"
            class="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs font-mono"
          />
        </label>
        <label class="block">
          <span class="text-[10px] text-gray-400 block mb-0.5">Valor (R$)</span>
          <input
            id="bill-amount"
            name="amount"
            type="text"
            required
            inputmode="numeric"
            placeholder="R$ 89,90"
            class="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs font-mono"
          />
        </label>
        <label class="block">
          <span class="text-[10px] text-gray-400 block mb-0.5">Vencimento</span>
          <input
            name="dueDate"
            type="date"
            required
            class="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs"
          />
        </label>
      </div>
      <div class="flex gap-2">
        <button type="submit" class="px-3 py-1 text-xs bg-cyan-600 hover:bg-cyan-500 text-white rounded">Criar</button>
        <button
          type="button"
          hx-get={`/partials/cliente/${customerId}/bills`}
          hx-target="#bills-section"
          hx-swap="outerHTML"
          class="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded"
        >
          Cancelar
        </button>
      </div>
    </form>
    <script
      dangerouslySetInnerHTML={{
        __html: `
(function(){
  const ref = document.getElementById('bill-ref');
  const amount = document.getElementById('bill-amount');
  if (ref) {
    ref.addEventListener('input', function() {
      let v = ref.value.replace(/[^0-9]/g, '').slice(0, 6);
      if (v.length > 4) v = v.slice(0, 4) + '-' + v.slice(4);
      ref.value = v;
    });
  }
  if (amount) {
    amount.addEventListener('input', function() {
      let v = amount.value.replace(/[^0-9]/g, '');
      if (!v) { amount.value = ''; return; }
      const cents = parseInt(v, 10);
      const reais = (cents / 100).toFixed(2).replace('.', ',');
      const withDots = reais.replace(/\\B(?=(\\d{3})+(?!\\d))/g, '.');
      amount.value = 'R$ ' + withDots;
    });
    // Normaliza antes de enviar — backend espera "89.90"
    const form = document.getElementById('bill-form');
    if (form) {
      form.addEventListener('submit', function() {
        const v = amount.value.replace(/[^0-9]/g, '');
        amount.value = v ? (parseInt(v, 10) / 100).toFixed(2) : '0';
      });
    }
  }
})();
`,
      }}
    />
  </>
);

const FormField: FC<{
  name: string;
  label: string;
  defaultValue?: string;
  type?: string;
  step?: string;
  placeholder?: string;
  required?: boolean;
}> = ({ name, label, defaultValue, type, step, placeholder, required }) => (
  <label class="block">
    <span class="text-xs uppercase text-gray-500 font-semibold tracking-wider">{label}</span>
    <input
      name={name}
      type={type ?? 'text'}
      step={step}
      value={defaultValue}
      placeholder={placeholder}
      required={required}
      class="mt-1 w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-cyan-500 transition"
    />
  </label>
);
