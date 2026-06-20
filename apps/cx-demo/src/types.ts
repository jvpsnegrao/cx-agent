export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';
export type Sentiment = 'neutro' | 'frustrado' | 'satisfeito' | 'urgente';

export type TicketCreateInput = {
  customerId: string;
  customerName: string;
  title: string;
  category: string;
  priority: TicketPriority;
  description: string;
};

export type TicketCreateResponse = {
  id: string;
  identifier: string;
};

export type HandoffCreateInput = {
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerPlan: string;
  conversationId: string;
  sentiment: Sentiment;
  resumo: string;
  ticketLinearId?: string;
  lastMessages: string[];
};

// Event names com underscore (não ponto) pra compatibilidade total com htmx-sse-ext.
export type StreamEvent =
  | { type: 'ticket_created'; ticketId: string; identifier: string; customerName: string; title: string }
  | { type: 'ticket_updated'; ticketId: string; status: string }
  | { type: 'handoff_opened'; conversationId: string; customerName: string; sentiment: Sentiment }
  | { type: 'handoff_claimed'; conversationId: string; claimedBy: string }
  | { type: 'handoff_resolved'; conversationId: string }
  | { type: 'message_in'; conversationId: string; content: string }
  | { type: 'message_out'; conversationId: string; content: string };
