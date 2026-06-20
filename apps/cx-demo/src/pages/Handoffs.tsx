import type { FC } from 'hono/jsx';
import { Shell } from './Shell.tsx';
import { SentimentBadge } from '../components/SentimentBadge.tsx';
import type { Sentiment } from '../types.ts';

export type HandoffRow = {
  conversationId: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerPlan: string;
  sentiment: Sentiment;
  humanTakeoverAt: Date | null;
  resumo: string | null;
  ticketLinearId: string | null;
  lastMessages: string[];
};

const fmtDate = (d: Date | null) =>
  d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

export const Handoffs: FC<{ rows: HandoffRow[] }> = ({ rows }) => (
  <Shell title="Handoffs" activeTab="handoffs">
    <div class="flex items-center justify-between mb-4">
      <div>
        <h2 class="text-xl font-semibold">Handoffs</h2>
        <p class="text-sm text-gray-400">{rows.length} escalações pra atendimento humano.</p>
      </div>
    </div>
    <div
      id="handoff-list"
      hx-get="/partials/handoffs"
      hx-trigger="sse:handoff_opened from:body, sse:handoff_claimed from:body, sse:handoff_resolved from:body"
      hx-swap="innerHTML"
    >
      <HandoffList rows={rows} />
    </div>
  </Shell>
);

export const HandoffList: FC<{ rows: HandoffRow[] }> = ({ rows }) => (
  <div class="grid gap-3">
    {rows.length === 0 ? (
      <div class="bg-gray-900 border border-gray-800 rounded-lg px-4 py-8 text-center text-gray-500 text-sm">
        Sem handoffs ativos. Quando a Nova escalar, o card aparece aqui.
      </div>
    ) : (
      rows.map((h) => (
        <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div class="flex items-start justify-between gap-4">
            <div class="flex-1">
              <div class="flex items-center gap-2 mb-1">
                <span class="font-semibold">{h.customerName}</span>
                <span class="text-gray-500 text-xs">{h.customerPhone}</span>
                <span class="text-gray-500 text-xs">· {h.customerPlan}</span>
                <SentimentBadge sentiment={h.sentiment} />
              </div>
              {h.resumo ? <p class="text-sm text-gray-300 mt-2">{h.resumo}</p> : null}
              {h.ticketLinearId ? (
                <p class="text-xs text-cyan-400 mt-1">🎫 ticket vinculado: {h.ticketLinearId}</p>
              ) : null}
              {h.lastMessages.length > 0 ? (
                <div class="mt-3">
                  <p class="text-xs text-gray-500 mb-1">últimas mensagens:</p>
                  <ul class="text-xs text-gray-400 space-y-0.5 pl-3 border-l border-gray-800">
                    {h.lastMessages.map((m) => (
                      <li>{m}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
            <div class="flex flex-col items-end gap-2 shrink-0">
              <span class="text-xs text-gray-500">{fmtDate(h.humanTakeoverAt)}</span>
              <div class="flex gap-2">
                <button
                  type="button"
                  hx-patch={`/actions/handoffs/${h.conversationId}/claim`}
                  hx-target="#handoff-list"
                  hx-swap="innerHTML"
                  class="px-2 py-1 text-xs bg-cyan-700 hover:bg-cyan-600 text-white rounded"
                >
                  Atender
                </button>
                <button
                  type="button"
                  hx-patch={`/actions/handoffs/${h.conversationId}/resolve`}
                  hx-target="#handoff-list"
                  hx-swap="innerHTML"
                  hx-confirm="Resolver este handoff?"
                  class="px-2 py-1 text-xs bg-green-700 hover:bg-green-600 text-white rounded"
                >
                  Resolver
                </button>
              </div>
            </div>
          </div>
        </div>
      ))
    )}
  </div>
);
