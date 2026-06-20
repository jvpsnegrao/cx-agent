import type { FC } from 'hono/jsx';
import { Shell } from './Shell.tsx';
import { PriorityBadge, StatusBadge } from '../components/SentimentBadge.tsx';

export type TicketRow = {
  id: string;
  externalId: string | null;
  title: string;
  category: string;
  priority: string;
  description: string;
  status: string;
  createdAt: Date;
  customerName: string | null;
  customerPhone: string | null;
};

export type AuditEntry = {
  id: string;
  action: string;
  payload: Record<string, unknown> | null;
  result: string;
  createdAt: Date;
};

const fmtDate = (d: Date) =>
  new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

const STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;
const PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;

const AuditEvent: FC<{ entry: AuditEntry }> = ({ entry }) => {
  const p = (entry.payload ?? {}) as Record<string, string | undefined>;
  let icon = '•';
  let title = entry.action;
  let body: string | null = null;
  switch (entry.action) {
    case 'abrir_ticket':
      icon = '🎫';
      title = `Chamado ${p.identifier ?? ''} aberto`;
      body = p.title ?? null;
      break;
    case 'ticket_updated':
      icon = '🔄';
      if (p.status) title = `Status alterado para "${p.status}"`;
      else if (p.priority) title = `Prioridade alterada para "${p.priority}"`;
      else title = 'Ticket atualizado';
      break;
    case 'ticket_update_added':
      icon = '📢';
      title = 'Atualização enviada ao cliente';
      body = p.message ?? null;
      break;
    case 'handoff_claimed':
      icon = '🙋';
      title = `${p.claimedBy ?? 'Atendente'} assumiu o atendimento`;
      break;
    case 'handoff_resolved':
      icon = '✅';
      title = 'Handoff resolvido';
      break;
    case 'escalar_atendente':
      icon = '🚨';
      title = 'Escalado pra atendente humano';
      body = p.resumo ?? null;
      break;
    case 'notify_failed':
      icon = '⚠️';
      title = 'Falha ao notificar cliente';
      body = p.error ?? null;
      break;
    default:
      title = entry.action;
  }
  return (
    <li class="relative">
      <span class="absolute -left-[1.30rem] top-0.5 w-4 h-4 rounded-full bg-gray-900 ring-2 ring-gray-800 flex items-center justify-center text-[10px]">
        {icon}
      </span>
      <div class="flex items-baseline justify-between gap-2">
        <span class="text-sm text-gray-200">{title}</span>
        <span class="text-[10px] text-gray-500 font-mono shrink-0">{fmtDate(entry.createdAt)}</span>
      </div>
      {body ? <p class="text-xs text-gray-400 mt-0.5 whitespace-pre-wrap">{body}</p> : null}
    </li>
  );
};

export const Tickets: FC<{
  rows: TicketRow[];
  selectedId?: string;
  selectedRow?: TicketRow;
  audit?: AuditEntry[];
  filterStatus?: string;
  filterPriority?: string;
  search?: string;
  counts: Record<string, number>;
}> = ({ rows, selectedId, selectedRow, audit, filterStatus, filterPriority, search, counts }) => (
  <Shell title="Tickets" activeTab="tickets">
    <div class="flex items-center justify-between mb-4">
      <div>
        <h2 class="text-lg font-semibold">Tickets</h2>
        <p class="text-xs text-gray-500">{rows.length} chamados abertos pela Nova ou painel</p>
      </div>
      <div class="flex items-center gap-2 text-xs">
        {STATUSES.map((s) => (
          <a
            href={`/tickets?status=${filterStatus === s ? '' : s}${filterPriority ? `&priority=${filterPriority}` : ''}`}
            class={`px-3 py-1.5 rounded-md font-medium transition ${
              filterStatus === s
                ? 'bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-500/40'
                : 'bg-gray-900 text-gray-400 hover:bg-gray-800 border border-gray-800'
            }`}
          >
            {s} <span class="text-gray-500 ml-1">{counts[s] ?? 0}</span>
          </a>
        ))}
        <div class="w-px h-6 bg-gray-800 mx-1" />
        <select
          name="priority"
          onchange={`location.href='/tickets${filterStatus ? '?status=' + filterStatus + '&' : '?'}priority=' + this.value`}
          class="bg-gray-900 border border-gray-800 text-xs rounded-md px-2 py-1.5 text-gray-300"
        >
          <option value="" selected={!filterPriority}>todas prioridades</option>
          {PRIORITIES.map((p) => (
            <option value={p} selected={filterPriority === p}>{p}</option>
          ))}
        </select>
      </div>
    </div>

    <div class="grid grid-cols-12 gap-4 h-[calc(100vh-12rem)]">
      <aside class="col-span-5 flex flex-col min-h-0 gap-3">
        <input
          type="search"
          name="q"
          value={search ?? ''}
          placeholder="Buscar por ONYX-N, título ou cliente…"
          hx-get="/partials/tickets"
          hx-include="this"
          hx-vals={`{${filterStatus ? `"status":"${filterStatus}"` : ''}${filterStatus && filterPriority ? ',' : ''}${filterPriority ? `"priority":"${filterPriority}"` : ''}}`}
          hx-trigger="input changed delay:300ms, search"
          hx-target="#ticket-list"
          hx-swap="innerHTML"
          class="w-full bg-gray-900 border border-gray-800 rounded-md px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-cyan-500 transition"
        />
        <div
          id="ticket-list"
          hx-get={`/partials/tickets${filterStatus || filterPriority ? `?${[
            filterStatus ? `status=${filterStatus}` : '',
            filterPriority ? `priority=${filterPriority}` : '',
          ].filter(Boolean).join('&')}` : ''}`}
          hx-trigger="sse:ticket_created, sse:ticket_updated"
          hx-swap="innerHTML"
          class="flex-1 min-h-0 overflow-y-auto scrollbar-thin bg-gray-900/50 border border-gray-800 rounded-lg"
        >
          <TicketList rows={rows} selectedId={selectedId} />
        </div>
      </aside>
      <section class="col-span-7 flex flex-col min-h-0">
        <div id="ticket-detail" class="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
          {selectedRow ? (
            <TicketDetail row={selectedRow} audit={audit ?? []} />
          ) : (
            <div class="h-full bg-gray-900/30 border border-gray-800 border-dashed rounded-lg flex items-center justify-center text-gray-500 text-sm">
              ← Selecione um ticket
            </div>
          )}
        </div>
      </section>
    </div>
  </Shell>
);

export const TicketList: FC<{ rows: TicketRow[]; selectedId?: string }> = ({ rows, selectedId }) => (
  <div>
    {rows.length === 0 ? (
      <div class="px-4 py-8 text-center text-gray-500 text-sm">Nenhum ticket no filtro atual.</div>
    ) : (
      rows.map((t) => (
        <a
          href={`/tickets/${t.id}`}
          class={`block px-4 py-3 border-b border-gray-800/60 transition ${
            selectedId === t.id ? 'bg-cyan-500/10 border-l-2 border-l-cyan-400' : 'hover:bg-gray-800/40'
          }`}
        >
          <div class="flex items-center justify-between gap-2 mb-1">
            <span class="font-mono text-xs text-cyan-400">{t.externalId ?? '—'}</span>
            <div class="flex items-center gap-1.5">
              <PriorityBadge priority={t.priority} />
              <StatusBadge status={t.status} />
            </div>
          </div>
          <div class="text-sm font-medium mb-1 truncate">{t.title}</div>
          <div class="flex items-center justify-between text-xs text-gray-500">
            <span class="truncate">{t.customerName ?? '—'} · {t.category}</span>
            <span class="shrink-0 ml-2">{fmtDate(t.createdAt)}</span>
          </div>
        </a>
      ))
    )}
  </div>
);

export const TicketDetail: FC<{ row: TicketRow; audit: AuditEntry[] }> = ({ row, audit }) => (
  <div class="bg-gray-900/50 border border-gray-800 rounded-lg p-5 space-y-5">
    <header class="pb-4 border-b border-gray-800">
      <div class="flex items-center justify-between gap-3 mb-2">
        <span class="font-mono text-sm text-cyan-400">{row.externalId ?? '—'}</span>
        <div class="flex items-center gap-2">
          <PriorityBadge priority={row.priority} />
          <form class="inline" hx-patch={`/actions/tickets/${row.id}/status`} hx-target="#ticket-detail" hx-swap="innerHTML" hx-trigger="change">
            <select name="status" class="bg-gray-800 border border-gray-700 text-xs rounded px-2 py-1 text-gray-200">
              {STATUSES.map((s) => (
                <option value={s} selected={s === row.status}>{s}</option>
              ))}
            </select>
          </form>
        </div>
      </div>
      <h2 class="text-xl font-semibold">{row.title}</h2>
      <div class="flex items-center gap-3 mt-2 text-xs text-gray-500">
        <span>{row.customerName ?? '—'}</span>
        <span class="font-mono">{row.customerPhone ?? ''}</span>
        <span>·</span>
        <span>{row.category}</span>
        <span>·</span>
        <span>aberto {fmtDate(row.createdAt)}</span>
      </div>
    </header>

    <section>
      <h3 class="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-2">Descrição</h3>
      <p class="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed bg-gray-900 border border-gray-800 rounded-md p-3">
        {row.description}
      </p>
    </section>

    <section>
      <h3 class="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">Timeline</h3>
      {audit.length === 0 ? (
        <div class="text-xs text-gray-500">Sem eventos.</div>
      ) : (
        <ol class="space-y-3 border-l border-gray-800 pl-4 ml-1">
          {audit.map((a) => (
            <AuditEvent entry={a} />
          ))}
        </ol>
      )}
    </section>

    <section>
      <h3 class="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">Nova atualização (notifica cliente no WhatsApp)</h3>
      <form
        hx-post={`/actions/tickets/${row.id}/update`}
        hx-target="#ticket-detail"
        hx-swap="innerHTML"
        class="space-y-2"
      >
        <textarea
          name="message"
          required
          rows={2}
          placeholder="Ex: Técnico chega amanhã 14h-16h. Pedimos que alguém esteja no local."
          class="w-full bg-gray-900 border border-gray-800 rounded-md px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-cyan-500 transition resize-none"
        />
        <div class="flex justify-end gap-2">
          <button type="submit" class="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-md text-xs font-medium transition">
            Enviar atualização
          </button>
        </div>
      </form>
    </section>
  </div>
);
