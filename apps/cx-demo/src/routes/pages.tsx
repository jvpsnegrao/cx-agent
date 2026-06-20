import { Hono } from 'hono';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { auditLog, bills, conversations, customers, tickets } from '@khal/db';
import { db } from '../db.ts';
import { issueSession, clearSession, requireSession, verifyPassword } from '../auth.ts';
import { emitStream } from '../events.ts';
import { Login } from '../pages/Login.tsx';
import { Tickets, TicketList, TicketDetail } from '../pages/Tickets.tsx';
import type { AuditEntry, TicketRow as _TR } from '../pages/Tickets.tsx';
import { notifyCustomer } from '../notify.ts';
import { updateSentimentFromMessage } from '../sentiment.ts';
import {
  Conversas,
  ConversasSidebar,
  MessageFeed,
} from '../pages/Conversas.tsx';
import {
  Clientes,
  ClientesList,
  ClienteDetail,
  ClienteForm,
  BillForm,
} from '../pages/Clientes.tsx';
import { plans } from '@khal/db';
import type { TicketRow } from '../pages/Tickets.tsx';
import type { ConversaRow, Msg } from '../pages/Conversas.tsx';
import type { BillRow, ClienteRow, PlanRow, TicketRowMini } from '../pages/Clientes.tsx';

export const pages = new Hono();

// ───── Public ─────

pages.get('/login', (c) => c.html(<Login />));

pages.post('/login', async (c) => {
  const form = await c.req.parseBody();
  const password = String(form.password ?? '');
  if (!verifyPassword(password)) {
    return c.html(<Login error="Senha incorreta." />, 401);
  }
  issueSession(c);
  return c.redirect('/');
});

pages.post('/logout', (c) => {
  clearSession(c);
  return c.redirect('/login');
});

// ───── Auth-protected ─────

const protectedPaths = ['/', '/tickets', '/conversas', '/conversas/*', '/clientes', '/clientes/*', '/partials/*', '/actions/*'] as const;
for (const path of protectedPaths) pages.use(path, requireSession);

// Redirects pra rotas removidas
pages.get('/handoffs', (c) => c.redirect('/conversas'));
pages.get('/faturas', (c) => c.redirect('/clientes'));

pages.get('/', (c) => c.redirect('/tickets'));

// ───── Tickets ─────

pages.get('/tickets', async (c) => {
  const status = c.req.query('status') || undefined;
  const priority = c.req.query('priority') || undefined;
  const q = c.req.query('q') || '';
  const [rows, counts] = await Promise.all([fetchTickets({ status, priority, q }), fetchTicketCounts()]);
  return c.html(
    <Tickets rows={rows} filterStatus={status} filterPriority={priority} search={q} counts={counts} />,
  );
});

pages.get('/tickets/:id', async (c) => {
  const id = c.req.param('id');
  const status = c.req.query('status') || undefined;
  const priority = c.req.query('priority') || undefined;
  const q = c.req.query('q') || '';
  const [rows, counts, audit] = await Promise.all([
    fetchTickets({ status, priority, q }),
    fetchTicketCounts(),
    fetchAuditForTicket(id),
  ]);
  const selectedRow = (await fetchTickets({ id })).at(0);
  return c.html(
    <Tickets
      rows={rows}
      selectedId={id}
      selectedRow={selectedRow}
      audit={audit}
      filterStatus={status}
      filterPriority={priority}
      search={q}
      counts={counts}
    />,
  );
});

pages.get('/partials/tickets', async (c) => {
  const status = c.req.query('status') || undefined;
  const priority = c.req.query('priority') || undefined;
  const q = c.req.query('q') || '';
  const rows = await fetchTickets({ status, priority, q });
  return c.html(<TicketList rows={rows} />);
});

// ───── Conversas ─────

pages.get('/conversas', async (c) => {
  const rows = await fetchConversations();
  return c.html(<Conversas rows={rows} />);
});

pages.get('/conversas/:id', async (c) => {
  const id = c.req.param('id');
  const rows = await fetchConversations();
  const selectedRow = rows.find((r) => r.id === id);
  const msgRows = await fetchMessages(id);
  return c.html(
    <Conversas rows={rows} selectedId={id} selectedRow={selectedRow} messages={msgRows} />,
  );
});

pages.get('/partials/conversas', async (c) => {
  const selectedId = c.req.query('selected');
  const rows = await fetchConversations();
  return c.html(<ConversasSidebar rows={rows} selectedId={selectedId} />);
});

pages.get('/partials/conversa/:id/messages', async (c) => {
  const id = c.req.param('id');
  const msgRows = await fetchMessages(id);
  return c.html(<MessageFeed messages={msgRows} />);
});

// ───── Clientes ─────

pages.get('/clientes', async (c) => {
  const q = c.req.query('q') ?? '';
  const [rows, plansList] = await Promise.all([fetchCustomers(q), fetchPlans()]);
  return c.html(<Clientes rows={rows} plans={plansList} search={q} />);
});

pages.get('/clientes/:id', async (c) => {
  const id = c.req.param('id');
  const q = c.req.query('q') ?? '';
  const [rows, plansList] = await Promise.all([fetchCustomers(q), fetchPlans()]);
  const selectedRow = rows.find((r) => r.id === id) ?? (await fetchCustomers('', id))[0];
  if (!selectedRow) return c.redirect('/clientes');
  const [bills_, tickets_] = await Promise.all([fetchBills(id), fetchTicketsByCustomer(id)]);
  return c.html(
    <Clientes
      rows={rows}
      selectedId={id}
      selectedRow={selectedRow}
      bills={bills_}
      tickets={tickets_}
      plans={plansList}
      search={q}
    />,
  );
});

pages.get('/partials/clientes', async (c) => {
  const q = c.req.query('q') ?? '';
  const rows = await fetchCustomers(q);
  return c.html(<ClientesList rows={rows} />);
});

pages.get('/partials/cliente/empty', (c) =>
  c.html(
    <div class="h-full bg-gray-900/30 border border-gray-800 border-dashed rounded-lg flex items-center justify-center text-gray-500 text-sm">
      ← Selecione um cliente ou clique em + Novo
    </div>,
  ),
);

pages.get('/partials/cliente/new', async (c) => {
  const plansList = await fetchPlans();
  return c.html(<ClienteForm action="/actions/clientes" title="Novo Cliente" plans={plansList} />);
});

pages.get('/partials/cliente/:id', async (c) => {
  const id = c.req.param('id');
  const [row] = await fetchCustomers('', id);
  if (!row) return c.html(<div class="text-gray-500 text-sm">Cliente não encontrado.</div>, 404);
  const [bills_, tickets_, plansList] = await Promise.all([
    fetchBills(id),
    fetchTicketsByCustomer(id),
    fetchPlans(),
  ]);
  return c.html(<ClienteDetail row={row} bills={bills_} tickets={tickets_} plans={plansList} />);
});

pages.get('/partials/cliente/:id/edit', async (c) => {
  const id = c.req.param('id');
  const [row] = await fetchCustomers('', id);
  if (!row) return c.html(<div class="text-gray-500 text-sm">Cliente não encontrado.</div>, 404);
  const plansList = await fetchPlans();
  return c.html(<ClienteForm row={row} action={`/actions/clientes/${id}`} title="Editar Cliente" plans={plansList} />);
});

pages.get('/partials/cliente/:id/bill/new', (c) =>
  c.html(<BillForm customerId={c.req.param('id')} />),
);

pages.get('/partials/cliente/:id/bills', async (c) => {
  const id = c.req.param('id');
  const bills_ = await fetchBills(id);
  return c.html(<BillsSection bills={bills_} customerId={id} />);
});

// ───── Actions ─────

async function applyClienteForm(form: Record<string, unknown>) {
  const planId = String(form.planId ?? '');
  const [plan] = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
  if (!plan) throw new Error('Plano inválido');
  const cep = String(form.cep ?? '').replace(/[^0-9]/g, '');
  const numero = String(form.numero ?? '').trim();
  const complemento = String(form.complemento ?? '').trim() || null;
  const address = `${numero}${complemento ? `, ${complemento}` : ''} — CEP ${cep}`;
  return {
    name: String(form.name ?? ''),
    phone: String(form.phone ?? ''),
    plan: plan.name,
    planId: plan.id,
    monthlyValue: plan.monthlyValueCents,
    dataAllowanceGb: plan.dataAllowanceGb,
    address,
    cep,
    numero,
    complemento,
    status: (form.status as 'active' | 'suspended' | 'cancelled') ?? 'active',
  };
}

pages.post('/actions/clientes', async (c) => {
  const form = await c.req.parseBody();
  let values;
  try {
    values = await applyClienteForm(form);
  } catch (e) {
    return c.text(e instanceof Error ? e.message : 'invalid', 400);
  }
  const [row] = await db.insert(customers).values(values).returning();
  if (!row) return c.text('falha', 500);
  c.header('HX-Trigger', 'customers:changed');
  const [bills_, tickets_, plansList] = await Promise.all([
    fetchBills(row.id),
    fetchTicketsByCustomer(row.id),
    fetchPlans(),
  ]);
  return c.html(<ClienteDetail row={row as ClienteRow} bills={bills_} tickets={tickets_} plans={plansList} />);
});

pages.post('/actions/clientes/:id', async (c) => {
  const id = c.req.param('id');
  const form = await c.req.parseBody();
  let values;
  try {
    values = await applyClienteForm(form);
  } catch (e) {
    return c.text(e instanceof Error ? e.message : 'invalid', 400);
  }
  const [row] = await db.update(customers).set(values).where(eq(customers.id, id)).returning();
  if (!row) return c.text('not found', 404);
  c.header('HX-Trigger', 'customers:changed');
  const [bills_, tickets_, plansList] = await Promise.all([
    fetchBills(id),
    fetchTicketsByCustomer(id),
    fetchPlans(),
  ]);
  return c.html(<ClienteDetail row={row as ClienteRow} bills={bills_} tickets={tickets_} plans={plansList} />);
});

pages.delete('/actions/clientes/:id', async (c) => {
  const id = c.req.param('id');
  await db.delete(customers).where(eq(customers.id, id));
  c.header('HX-Trigger', 'customers:changed');
  return c.html(
    <div class="h-full bg-gray-900/30 border border-gray-800 border-dashed rounded-lg flex items-center justify-center text-gray-500 text-sm">
      Cliente excluído. ← selecione outro ou clique em + Novo
    </div>,
  );
});

pages.post('/actions/clientes/:id/bills', async (c) => {
  const id = c.req.param('id');
  const form = await c.req.parseBody();
  await db.insert(bills).values({
    customerId: id,
    referenceMonth: String(form.referenceMonth ?? ''),
    amountCents: Math.round(Number(form.amount ?? '0') * 100),
    dueDate: new Date(String(form.dueDate ?? Date.now())),
    status: 'open',
  });
  const bills_ = await fetchBills(id);
  return c.html(<BillsSection bills={bills_} customerId={id} />);
});

pages.patch('/actions/bills/:id/pay', async (c) => {
  const id = c.req.param('id');
  const [row] = await db
    .update(bills)
    .set({ status: 'paid' })
    .where(eq(bills.id, id))
    .returning();
  if (!row) return c.text('not found', 404);
  const bills_ = await fetchBills(row.customerId);
  return c.html(<BillsSection bills={bills_} customerId={row.customerId} />);
});

pages.post('/actions/conversas/:id/take', async (c) => {
  const id = c.req.param('id');
  const [convo] = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
  if (!convo) return c.text('not found', 404);
  // Só marca takeover — sentiment preservado (real, não falso 'neutro').
  await db
    .update(conversations)
    .set({ humanTakeoverAt: new Date() })
    .where(eq(conversations.id, id));
  await db.insert(auditLog).values({
    customerId: convo.customerId,
    action: 'handoff_claimed',
    payload: { conversationId: id, claimedBy: 'Atendente CX', initiated_by: 'painel' },
    result: 'ok',
  });
  emitStream({
    type: 'handoff_opened',
    conversationId: id,
    customerName: '—',
    sentiment: convo.lastSentiment,
  });
  // Browser navega pra /conversas/:id — re-renderiza o detail com humanTakeoverAt truthy,
  // o que faz o textarea de envio aparecer sem precisar refresh manual.
  c.header('HX-Redirect', `/conversas/${id}`);
  return c.body(null, 204);
});

pages.post('/actions/conversas/:id/send', async (c) => {
  const id = c.req.param('id');
  const form = await c.req.parseBody();
  const text = String(form.text ?? '').trim();
  if (!text) return c.text('mensagem vazia', 400);
  const [convo] = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
  if (!convo) return c.text('conversa não encontrada', 404);
  const [cust] = await db.select().from(customers).where(eq(customers.id, convo.customerId)).limit(1);
  if (!cust) return c.text('cliente não encontrado', 404);

  // Fire-and-forget: não bloqueia resposta esperando Omni.
  // Falha vira audit_log; UI percebe via SSE quando omni-poll detecta msg em public.messages.
  notifyCustomer(cust.phone, text)
    .then((r) => {
      if (!r.ok) {
        return db.insert(auditLog).values({
          customerId: convo.customerId,
          action: 'notify_failed',
          payload: { conversationId: id, error: r.error ?? '?', preview: text.slice(0, 100) },
          result: 'error',
        });
      }
    })
    .catch((err) => console.error('[send] notify error', err));

  // Não emit message_out aqui — deixa omni-poll detectar quando msg cair em
  // public.messages. Assim a optimistic bubble do client fica visível até
  // a real chegar, sem race de swap intermediário.
  return c.body(null, 204);
});

pages.patch('/actions/handoffs/:id/claim', async (c) => {
  const id = c.req.param('id');
  const [convo] = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
  if (convo) {
    await db.insert(auditLog).values({
      customerId: convo.customerId,
      action: 'handoff_claimed',
      payload: { conversationId: id, claimedBy: 'Atendente CX' },
      result: 'ok',
    });
    emitStream({ type: 'handoff_claimed', conversationId: id, claimedBy: 'Atendente CX' });
  }
  const rows = await fetchConversations();
  return c.html(<ConversasSidebar rows={rows} selectedId={id} />);
});

pages.patch('/actions/handoffs/:id/resolve', async (c) => {
  const id = c.req.param('id');
  const [convo] = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
  if (convo) {
    await db
      .update(conversations)
      .set({ humanTakeoverAt: null })
      .where(eq(conversations.id, id));
    await updateSentimentFromMessage(id, '').catch(() => {
      /* não-crítico */
    });
    await db.insert(auditLog).values({
      customerId: convo.customerId,
      action: 'handoff_resolved',
      payload: { conversationId: id },
      result: 'ok',
    });
    emitStream({ type: 'handoff_resolved', conversationId: id });
  }
  // Browser navega pra /conversas/:id — re-renderiza o detail sem textarea (handoff null)
  c.header('HX-Redirect', `/conversas/${id}`);
  return c.body(null, 204);
});

pages.patch('/actions/tickets/:id/status', async (c) => {
  const id = c.req.param('id');
  const form = await c.req.parseBody();
  const status = String(form.status ?? '');
  if (!['open', 'in_progress', 'resolved', 'closed'].includes(status)) {
    return c.text('invalid status', 400);
  }
  const [row] = await db
    .update(tickets)
    .set({ status: status as 'open' | 'in_progress' | 'resolved' | 'closed' })
    .where(eq(tickets.id, id))
    .returning();
  if (row) {
    await db.insert(auditLog).values({
      customerId: row.customerId,
      action: 'ticket_updated',
      payload: { ticketId: id, status },
      result: 'ok',
    });
    emitStream({ type: 'ticket_updated', ticketId: id, status });

    // Notifica cliente no WhatsApp
    const [cust] = await db.select().from(customers).where(eq(customers.id, row.customerId)).limit(1);
    if (cust) {
      const STATUS_LABEL: Record<string, string> = {
        open: 'aberto',
        in_progress: 'em andamento',
        resolved: 'resolvido',
        closed: 'fechado',
      };
      const text = `📢 Atualização no chamado *${row.externalId ?? ''}*\n\nStatus agora: *${STATUS_LABEL[status] ?? status}*`;
      const r = await notifyCustomer(cust.phone, text);
      if (!r.ok) {
        await db.insert(auditLog).values({
          customerId: row.customerId,
          action: 'notify_failed',
          payload: { ticketId: id, error: r.error ?? '?' },
          result: 'error',
        });
      }
    }
  }
  const updatedRow = (await fetchTickets({ id })).at(0);
  const audit = await fetchAuditForTicket(id);
  if (!updatedRow) return c.text('not found', 404);
  return c.html(<TicketDetail row={updatedRow} audit={audit} />);
});

pages.post('/actions/tickets/:id/update', async (c) => {
  const id = c.req.param('id');
  const form = await c.req.parseBody();
  const message = String(form.message ?? '').trim();
  if (!message) return c.text('mensagem vazia', 400);

  const [row] = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  if (!row) return c.text('not found', 404);
  const [cust] = await db.select().from(customers).where(eq(customers.id, row.customerId)).limit(1);

  await db.insert(auditLog).values({
    customerId: row.customerId,
    action: 'ticket_update_added',
    payload: { ticketId: id, message },
    result: 'ok',
  });
  emitStream({ type: 'ticket_updated', ticketId: id, status: row.status });

  if (cust) {
    const text = `📢 Atualização no chamado *${row.externalId ?? ''}*\n\n${message}`;
    const r = await notifyCustomer(cust.phone, text);
    if (!r.ok) {
      await db.insert(auditLog).values({
        customerId: row.customerId,
        action: 'notify_failed',
        payload: { ticketId: id, error: r.error ?? '?' },
        result: 'error',
      });
    }
  }

  const updatedRow = (await fetchTickets({ id })).at(0);
  const audit = await fetchAuditForTicket(id);
  if (!updatedRow) return c.text('not found', 404);
  return c.html(<TicketDetail row={updatedRow} audit={audit} />);
});

// ───── Inline component pra reuso de BillsSection ─────

import type { FC } from 'hono/jsx';
const BillsSection: FC<{ bills: BillRow[]; customerId: string }> = ({ bills: bs, customerId }) => (
  <div id="bills-section" class="space-y-2">
    {bs.length === 0 ? (
      <div class="text-center text-xs text-gray-500 py-4 border border-dashed border-gray-800 rounded">Sem faturas</div>
    ) : (
      bs.map((b) => (
        <div class="flex items-center justify-between bg-gray-900 rounded-md px-3 py-2 border border-gray-800">
          <div class="flex items-center gap-3">
            <span class="font-mono text-xs text-gray-400">{b.referenceMonth}</span>
            <span class="font-medium text-sm">R$ {(b.amountCents / 100).toFixed(2).replace('.', ',')}</span>
            <span class="text-xs text-gray-500">
              vence {new Date(b.dueDate).toLocaleDateString('pt-BR')}
            </span>
            <span
              class={`inline-flex px-2 py-0.5 rounded text-xs ${
                b.status === 'paid'
                  ? 'bg-green-900/40 text-green-300'
                  : b.status === 'overdue'
                  ? 'bg-red-900/40 text-red-300'
                  : 'bg-cyan-900/40 text-cyan-300'
              }`}
            >
              {b.status}
            </span>
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
);

// ───── Fetchers ─────

async function fetchTickets(
  filters: { id?: string; status?: string; priority?: string; q?: string } = {},
): Promise<TicketRow[]> {
  const conds: Array<ReturnType<typeof eq> | ReturnType<typeof sql>> = [];
  if (filters.id) conds.push(eq(tickets.id, filters.id));
  if (filters.status) conds.push(eq(tickets.status, filters.status as 'open' | 'in_progress' | 'resolved' | 'closed'));
  if (filters.priority) conds.push(eq(tickets.priority, filters.priority as 'low' | 'medium' | 'high' | 'urgent'));
  const term = filters.q?.trim() ?? '';
  if (term) {
    const pattern = `%${term}%`;
    conds.push(
      sql`(${tickets.externalId} ILIKE ${pattern} OR ${tickets.title} ILIKE ${pattern} OR ${customers.name} ILIKE ${pattern} OR ${customers.phone} ILIKE ${pattern})`,
    );
  }
  const where = conds.length > 0 ? and(...conds) : undefined;
  const q = db
    .select({
      id: tickets.id,
      externalId: tickets.externalId,
      title: tickets.title,
      category: tickets.category,
      priority: tickets.priority,
      description: tickets.description,
      status: tickets.status,
      createdAt: tickets.createdAt,
      customerName: customers.name,
      customerPhone: customers.phone,
    })
    .from(tickets)
    .leftJoin(customers, eq(customers.id, tickets.customerId))
    .orderBy(desc(tickets.createdAt))
    .limit(100);
  const rows = await (where ? q.where(where) : q);
  return rows as TicketRow[];
}

async function fetchTicketCounts(): Promise<Record<string, number>> {
  const rows = await db
    .select({ status: tickets.status, count: sql<number>`count(*)::int` })
    .from(tickets)
    .groupBy(tickets.status);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = r.count;
  return out;
}

async function fetchAuditForTicket(ticketId: string): Promise<AuditEntry[]> {
  const rows = await db.execute<{
    id: string;
    action: string;
    payload: Record<string, unknown> | null;
    result: string;
    created_at: Date;
  }>(sql`
    SELECT id::text, action, payload, result, created_at
    FROM khal.audit_log
    WHERE payload->>'ticketId' = ${ticketId}
       OR payload->>'identifier' = (SELECT external_id FROM khal.tickets WHERE id = ${ticketId}::uuid)
    ORDER BY created_at ASC
    LIMIT 50
  `);
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    payload: r.payload,
    result: r.result,
    createdAt: r.created_at,
  }));
}

async function fetchMessages(id: string): Promise<Msg[]> {
  const rows = await db.execute<{
    id: string;
    is_from_me: boolean;
    text_content: string | null;
    created_at: Date;
  }>(sql`
    SELECT m.id::text, m.is_from_me, m.text_content, m.created_at
    FROM public.messages m
    JOIN public.chats ch ON ch.id = m.chat_id
    JOIN khal.conversations conv ON conv.id = ${id}::uuid
    JOIN khal.customers cust ON cust.id = conv.customer_id
    WHERE
      regexp_replace(ch.canonical_id, '@.*', '') = regexp_replace(cust.phone, '\\+', '')
      OR regexp_replace(ch.external_id, '@.*', '') = regexp_replace(cust.phone, '\\+', '')
    ORDER BY m.created_at ASC
    LIMIT 200
  `);
  return rows.map((r) => ({
    id: r.id,
    role: r.is_from_me ? 'nova' : 'customer',
    content: r.text_content ?? '',
    createdAt: r.created_at,
  })) as Msg[];
}

async function fetchConversations(): Promise<ConversaRow[]> {
  const rows = await db.execute<{
    id: string;
    customer_id: string;
    customer_name: string;
    customer_phone: string;
    customer_plan: string | null;
    last_sentiment: string;
    human_takeover_at: Date | null;
    started_at: Date;
    message_count: number;
    last_message_preview: string | null;
    last_message_at: Date | null;
  }>(sql`
    SELECT
      conv.id::text,
      conv.customer_id::text,
      cust.name AS customer_name,
      cust.phone AS customer_phone,
      cust.plan AS customer_plan,
      conv.last_sentiment,
      conv.human_takeover_at,
      conv.started_at,
      COALESCE(stats.cnt, 0)::int AS message_count,
      stats.preview AS last_message_preview,
      stats.last_at AS last_message_at
    FROM khal.conversations conv
    JOIN khal.customers cust ON cust.id = conv.customer_id
    LEFT JOIN LATERAL (
      SELECT
        count(*) AS cnt,
        max(m.created_at) AS last_at,
        (SELECT m2.text_content FROM public.messages m2
         JOIN public.chats ch2 ON ch2.id = m2.chat_id
         WHERE
           regexp_replace(ch2.canonical_id, '@.*', '') = regexp_replace(cust.phone, '\\+', '')
           OR regexp_replace(ch2.external_id, '@.*', '') = regexp_replace(cust.phone, '\\+', '')
         ORDER BY m2.created_at DESC LIMIT 1) AS preview
      FROM public.messages m
      JOIN public.chats ch ON ch.id = m.chat_id
      WHERE
        regexp_replace(ch.canonical_id, '@.*', '') = regexp_replace(cust.phone, '\\+', '')
        OR regexp_replace(ch.external_id, '@.*', '') = regexp_replace(cust.phone, '\\+', '')
    ) AS stats ON true
    ORDER BY COALESCE(stats.last_at, conv.started_at) DESC
    LIMIT 50
  `);
  return rows.map((r) => ({
    id: r.id,
    customerId: r.customer_id,
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    customerPlan: r.customer_plan,
    lastSentiment: r.last_sentiment as ConversaRow['lastSentiment'],
    humanTakeoverAt: r.human_takeover_at,
    startedAt: r.started_at,
    messageCount: r.message_count,
    lastMessagePreview: r.last_message_preview,
    lastMessageAt: r.last_message_at,
  })) as ConversaRow[];
}

async function fetchCustomers(q = '', byId = ''): Promise<ClienteRow[]> {
  if (byId) {
    return (await db.select().from(customers).where(eq(customers.id, byId)).limit(1)) as ClienteRow[];
  }
  const term = q.trim();
  if (!term) {
    return (await db.select().from(customers).orderBy(asc(customers.name))) as ClienteRow[];
  }
  const pattern = `%${term}%`;
  return (await db
    .select()
    .from(customers)
    .where(
      sql`${customers.name} ILIKE ${pattern} OR ${customers.phone} ILIKE ${pattern} OR ${customers.plan} ILIKE ${pattern}`,
    )
    .orderBy(asc(customers.name))) as ClienteRow[];
}

async function fetchPlans(): Promise<PlanRow[]> {
  const rows = await db
    .select({
      id: plans.id,
      name: plans.name,
      monthlyValueCents: plans.monthlyValueCents,
      dataAllowanceGb: plans.dataAllowanceGb,
    })
    .from(plans)
    .where(eq(plans.active, true))
    .orderBy(plans.monthlyValueCents);
  return rows as PlanRow[];
}

async function fetchBills(customerId: string): Promise<BillRow[]> {
  const rows = await db
    .select({
      id: bills.id,
      referenceMonth: bills.referenceMonth,
      amountCents: bills.amountCents,
      dueDate: bills.dueDate,
      status: bills.status,
      pdfUrl: bills.pdfUrl,
    })
    .from(bills)
    .where(eq(bills.customerId, customerId))
    .orderBy(desc(bills.dueDate));
  return rows as BillRow[];
}

async function fetchTicketsByCustomer(customerId: string): Promise<TicketRowMini[]> {
  const rows = await db
    .select({
      id: tickets.id,
      externalId: tickets.externalId,
      title: tickets.title,
      status: tickets.status,
      createdAt: tickets.createdAt,
    })
    .from(tickets)
    .where(eq(tickets.customerId, customerId))
    .orderBy(desc(tickets.createdAt))
    .limit(10);
  return rows as TicketRowMini[];
}
