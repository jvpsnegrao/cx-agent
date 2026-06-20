import type { TicketBackend } from '../domain/ticket.ts';
import type { HandoffPayload, HandoffBackend } from '../domain/handoff.ts';

const PRIORITY_FALLBACK = 'medium';

/**
 * Adapter que substitui Linear (tickets) e Slack (handoffs) por um único
 * mini-backend HTTP (`cx-demo`) rodando local ou hospedado. O backend
 * persiste tickets em khal.tickets, marca handoffs em conversations, e
 * empurra eventos pro painel via SSE.
 *
 * Mesma instância serve as DUAS interfaces (TicketBackend + HandoffBackend)
 * pra economizar boilerplate no MCP server.
 */
export function createCxDemoAdapter(baseUrl: string, token: string): TicketBackend & HandoffBackend {
  const post = async <T>(path: string, body: unknown): Promise<T> => {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`cx-demo ${path} ${res.status}: ${text}`);
    }
    return (await res.json()) as T;
  };

  return {
    async createIssue(input) {
      const r = await post<{ id: string; identifier: string }>('/api/v1/tickets', {
        customerId: input.customerId,
        customerName: input.customerName,
        title: input.title,
        category: input.category,
        priority: input.priority ?? PRIORITY_FALLBACK,
        description: input.description,
      });
      return { id: r.id, identifier: r.identifier };
    },

    async postHandoff(payload: HandoffPayload & { lastMessages: string[] }) {
      await post('/api/v1/handoffs', {
        conversationId: payload.conversationId,
        customerId: payload.customerId,
        customerName: payload.customerName,
        customerPhone: payload.customerPhone,
        customerPlan: payload.customerPlan,
        sentiment: payload.sentiment,
        resumo: payload.resumo,
        ticketLinearId: payload.ticketLinearId,
        lastMessages: payload.lastMessages,
      });
    },
  };
}
