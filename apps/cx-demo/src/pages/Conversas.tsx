import type { FC } from 'hono/jsx';
import { Shell } from './Shell.tsx';
import { SentimentBadge } from '../components/SentimentBadge.tsx';
import type { Sentiment } from '../types.ts';

export type ConversaRow = {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerPlan: string | null;
  lastSentiment: Sentiment;
  humanTakeoverAt: Date | null;
  startedAt: Date;
  messageCount: number;
  lastMessagePreview: string | null;
  lastMessageAt: Date | null;
};

export type Msg = {
  id: string;
  role: 'customer' | 'nova' | 'tool' | 'system';
  content: string;
  createdAt: Date;
};

const fmtRel = (d: Date | null) => {
  if (!d) return '—';
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const dd = Math.floor(h / 24);
  return `${dd}d`;
};

const fmtTime = (d: Date) =>
  new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export const Conversas: FC<{
  rows: ConversaRow[];
  selectedId?: string;
  selectedRow?: ConversaRow;
  messages?: Msg[];
}> = ({ rows, selectedId, selectedRow, messages }) => (
  <Shell title="Conversas" activeTab="conversas">
    <div class="grid grid-cols-12 gap-4 h-[calc(100vh-7rem)]">
      <aside class="col-span-4 flex flex-col gap-3 min-h-0">
        <div class="flex items-center justify-between px-1">
          <div>
            <h2 class="text-lg font-semibold">Conversas</h2>
            <p class="text-xs text-gray-500">
              {rows.length} threads · {rows.filter((r) => r.humanTakeoverAt).length} em handoff
            </p>
          </div>
        </div>
        <div
          id="conversas-sidebar"
          hx-get={`/partials/conversas${selectedId ? `?selected=${selectedId}` : ''}`}
          hx-trigger="sse:message_in, sse:message_out, sse:handoff_opened, sse:handoff_claimed, sse:handoff_resolved"
          hx-swap="innerHTML"
          class="flex-1 min-h-0 overflow-y-auto scrollbar-thin bg-gray-900/50 border border-gray-800 rounded-lg"
        >
          <ConversasSidebar rows={rows} selectedId={selectedId} />
        </div>
      </aside>
      <section class="col-span-8 flex flex-col min-h-0">
        {selectedId && selectedRow ? (
          <ConversaDetail row={selectedRow} messages={messages ?? []} />
        ) : (
          <div class="flex-1 bg-gray-900/30 border border-gray-800 border-dashed rounded-lg flex items-center justify-center text-gray-500 text-sm">
            ← Selecione uma conversa
          </div>
        )}
      </section>
    </div>
  </Shell>
);

export const ConversasSidebar: FC<{ rows: ConversaRow[]; selectedId?: string }> = ({ rows, selectedId }) => {
  // Handoffs no topo, depois o resto por last activity
  const handoffs = rows.filter((r) => r.humanTakeoverAt);
  const others = rows.filter((r) => !r.humanTakeoverAt);
  return (
    <div>
      {handoffs.length > 0 ? (
        <div>
          <div class="px-3 py-2 text-[10px] uppercase tracking-wider text-amber-400/80 font-semibold border-b border-gray-800 bg-amber-950/20">
            🚨 Handoffs ativos
          </div>
          {handoffs.map((c) => (
            <ConversaItem c={c} selectedId={selectedId} highlight />
          ))}
        </div>
      ) : null}
      {others.length > 0 ? (
        <div>
          {handoffs.length > 0 ? (
            <div class="px-3 py-2 text-[10px] uppercase tracking-wider text-gray-500 font-semibold border-b border-gray-800">
              Conversas
            </div>
          ) : null}
          {others.map((c) => (
            <ConversaItem c={c} selectedId={selectedId} />
          ))}
        </div>
      ) : null}
      {rows.length === 0 ? (
        <div class="px-4 py-8 text-center text-gray-500 text-sm">Sem conversas ainda.</div>
      ) : null}
    </div>
  );
};

const ConversaItem: FC<{ c: ConversaRow; selectedId?: string; highlight?: boolean }> = ({ c, selectedId, highlight }) => {
  const selected = selectedId === c.id;
  return (
    <a
      href={`/conversas/${c.id}`}
      class={`block px-4 py-3 border-b border-gray-800/60 transition ${
        selected ? 'bg-cyan-500/10 border-l-2 border-l-cyan-400' : highlight ? 'bg-amber-950/10 hover:bg-amber-950/20' : 'hover:bg-gray-800/40'
      }`}
    >
      <div class="flex items-center justify-between gap-2 mb-1">
        <span class="font-medium text-sm truncate">{c.customerName}</span>
        <span class="text-[10px] text-gray-500 shrink-0">{fmtRel(c.lastMessageAt ?? c.startedAt)}</span>
      </div>
      <div class="flex items-center gap-2 mb-1">
        <span class="text-[11px] text-gray-500 font-mono truncate">{c.customerPhone}</span>
        <SentimentBadge sentiment={c.lastSentiment} />
      </div>
      {c.lastMessagePreview ? (
        <p class="text-xs text-gray-400 truncate">{c.lastMessagePreview}</p>
      ) : null}
    </a>
  );
};

const ConversaDetail: FC<{ row: ConversaRow; messages: Msg[] }> = ({ row, messages }) => (
  <div class="flex-1 flex flex-col min-h-0 bg-gray-900/50 border border-gray-800 rounded-lg overflow-hidden">
    <div class="px-5 py-3 border-b border-gray-800 flex items-center justify-between gap-4 bg-gray-900/50">
      <div class="flex items-center gap-3 min-w-0">
        <div class="w-9 h-9 rounded-full bg-gradient-to-br from-cyan-500/20 to-cyan-700/30 flex items-center justify-center text-cyan-300 font-semibold text-sm shrink-0">
          {row.customerName.slice(0, 1).toUpperCase()}
        </div>
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="font-semibold truncate">{row.customerName}</span>
            <SentimentBadge sentiment={row.lastSentiment} />
          </div>
          <div class="text-xs text-gray-500 font-mono">{row.customerPhone}</div>
        </div>
      </div>
      <div class="flex items-center gap-2">
        {row.humanTakeoverAt ? (
          <>
            <span class="text-xs text-amber-400 font-medium">🚨 em handoff</span>
            <button
              type="button"
              hx-patch={`/actions/handoffs/${row.id}/resolve`}
              hx-target="#conversas-sidebar"
              hx-swap="innerHTML"
              hx-confirm="Devolver atendimento pra Nova?"
              class="px-2.5 py-1 text-xs bg-green-600 hover:bg-green-500 text-white rounded font-medium transition"
            >
              Resolver handoff
            </button>
          </>
        ) : (
          <button
            type="button"
            hx-post={`/actions/conversas/${row.id}/take`}
            hx-target="#conversas-sidebar"
            hx-swap="innerHTML"
            hx-confirm="Assumir essa conversa? Você passa a falar diretamente com o cliente."
            class="px-2.5 py-1 text-xs bg-cyan-600 hover:bg-cyan-500 text-white rounded font-medium transition"
          >
            Assumir conversa
          </button>
        )}
      </div>
    </div>
    <div
      id="message-feed"
      hx-get={`/partials/conversa/${row.id}/messages`}
      hx-trigger="sse:message_in, sse:message_out"
      hx-swap="innerHTML"
      class="flex-1 min-h-0 overflow-y-auto scrollbar-thin"
      hx-on--htmx-after-swap="this.scrollTop = this.scrollHeight; this.querySelectorAll('[data-optimistic]').forEach(el => el.remove());"
    >
      <MessageFeed messages={messages} />
    </div>
    {row.humanTakeoverAt ? (
      <>
        <form
          id="send-form"
          action={`/actions/conversas/${row.id}/send`}
          method="post"
          class="border-t border-gray-800 bg-gray-900/40 px-4 py-3 shrink-0"
        >
          <div id="send-err" class="text-xs text-red-400 mb-1 min-h-[1em] empty:hidden" />
          <div class="flex items-end gap-2">
            <textarea
              id="send-ta"
              name="text"
              required
              placeholder="Digite uma mensagem…"
              autofocus
              style="height:38px;"
              class="flex-1 bg-gray-800 border border-gray-700 rounded-2xl px-4 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-cyan-500 focus:bg-gray-800/80 transition resize-none overflow-hidden disabled:opacity-60 leading-snug"
            />
            <button
              id="send-btn"
              type="submit"
              title="Enviar (Enter)"
              class="w-10 h-10 bg-cyan-600 hover:bg-cyan-500 text-white rounded-full text-base font-bold transition shrink-0 flex items-center justify-center disabled:opacity-50"
            >
              ➤
            </button>
          </div>
        </form>
        <script
          dangerouslySetInnerHTML={{
            __html: `
(function(){
  const f = document.getElementById('send-form');
  const ta = document.getElementById('send-ta');
  const btn = document.getElementById('send-btn');
  const err = document.getElementById('send-err');
  if (!f || !ta || !btn || !err) return;

  function autoGrow() {
    ta.style.height = '38px';
    const sh = ta.scrollHeight;
    const ch = ta.clientHeight;
    if (sh > ch) {
      const h = Math.min(sh, 128);
      ta.style.height = h + 'px';
      ta.style.overflowY = sh > 128 ? 'auto' : 'hidden';
    } else {
      ta.style.overflowY = 'hidden';
    }
  }

  ta.addEventListener('input', autoGrow);

  ta.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey && !ta.disabled && ta.value.trim()) {
      e.preventDefault();
      f.requestSubmit();
    }
  });

  function addOptimisticBubble(text) {
    const feed = document.getElementById('message-feed');
    if (!feed) return null;
    const container = feed.querySelector('div.p-4') || feed;
    const wrap = document.createElement('div');
    wrap.className = 'flex justify-end optimistic-msg';
    wrap.dataset.optimistic = '1';
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    wrap.innerHTML =
      '<div class="max-w-[75%] rounded-2xl px-3.5 py-2 bg-cyan-600/60 text-white rounded-br-sm transition-opacity">' +
        '<div class="text-sm whitespace-pre-wrap break-words"></div>' +
        '<div class="text-[10px] mt-1 text-cyan-100/70">' + hh + ':' + mm + ' · enviando…</div>' +
      '</div>';
    wrap.querySelector('.text-sm').textContent = text;
    container.appendChild(wrap);
    feed.scrollTop = feed.scrollHeight;
    return wrap;
  }

  function markBubbleSent(bubble) {
    if (!bubble) return;
    const inner = bubble.firstElementChild;
    if (inner) inner.classList.replace('bg-cyan-600/60', 'bg-cyan-600/90');
    const meta = bubble.querySelector('.text-\\[10px\\]');
    if (meta) meta.textContent = meta.textContent.replace(' · enviando…', '');
  }

  function markBubbleError(bubble) {
    if (!bubble) return;
    const inner = bubble.firstElementChild;
    if (inner) {
      inner.classList.remove('bg-cyan-600/60', 'bg-cyan-600/90');
      inner.classList.add('bg-red-600/60');
    }
    const meta = bubble.querySelector('.text-\\[10px\\]');
    if (meta) meta.textContent = meta.textContent.replace(' · enviando…', ' · falhou');
  }

  f.addEventListener('submit', async function(e) {
    e.preventDefault();
    if (f.dataset.sending === '1') return;
    const text = ta.value.trim();
    if (!text) return;
    f.dataset.sending = '1';
    ta.value = '';
    ta.style.height = '38px';
    ta.style.overflowY = 'hidden';
    ta.disabled = true;
    btn.disabled = true;
    btn.textContent = '…';
    const bubble = addOptimisticBubble(text);
    try {
      const r = await fetch(f.action, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ text: text }).toString(),
      });
      if (!r.ok) {
        const t = await r.text();
        markBubbleError(bubble);
        ta.value = text;
        autoGrow();
        err.textContent = (t || 'erro ' + r.status).slice(0, 160);
        setTimeout(function(){ err.textContent = ''; }, 4000);
      } else {
        markBubbleSent(bubble);
        // bubble será substituído quando feed re-renderizar via SSE message_out
      }
    } catch (ex) {
      markBubbleError(bubble);
      ta.value = text;
      autoGrow();
      err.textContent = 'rede: ' + (ex && ex.message ? ex.message : 'falhou');
      setTimeout(function(){ err.textContent = ''; }, 4000);
    } finally {
      f.dataset.sending = '';
      ta.disabled = false;
      btn.disabled = false;
      btn.textContent = '➤';
      ta.focus();
    }
  });
})();
`,
          }}
        />
      </>
    ) : null}
  </div>
);

export const MessageFeed: FC<{ messages: Msg[] }> = ({ messages }) => (
  <div class="p-4 space-y-2.5">
    {messages.length === 0 ? (
      <div class="text-center text-gray-500 text-sm py-8">Nenhuma mensagem ainda.</div>
    ) : (
      messages.map((m, i) => {
        const isCustomer = m.role === 'customer';
        const isNova = m.role === 'nova';
        const isSystem = m.role === 'system' || m.role === 'tool';
        return (
          <div class={`flex ${isCustomer ? 'justify-start' : 'justify-end'}`}>
            <div
              class={`max-w-[75%] rounded-2xl px-3.5 py-2 ${
                isCustomer
                  ? 'bg-gray-800 text-gray-100 rounded-bl-sm'
                  : isNova
                  ? 'bg-cyan-600/90 text-white rounded-br-sm'
                  : 'bg-gray-800/30 text-gray-400 text-xs italic'
              }`}
            >
              <div class="text-sm whitespace-pre-wrap break-words">{m.content}</div>
              <div
                class={`text-[10px] mt-1 ${
                  isCustomer ? 'text-gray-500' : isNova ? 'text-cyan-100/70' : 'text-gray-500'
                }`}
              >
                {fmtTime(m.createdAt)}
              </div>
            </div>
          </div>
        );
      })
    )}
    {/* Auto-scroll pro final no load inicial */}
    <script
      dangerouslySetInnerHTML={{
        __html: `(function(){const f=document.getElementById('message-feed');if(f)f.scrollTop=f.scrollHeight;})();`,
      }}
    />
  </div>
);
