import { desc, eq } from 'drizzle-orm';
import { auditLog, conversations, messages } from '@khal/db';
import type { DbClient } from '../db/client.ts';

export type Sentiment = 'neutro' | 'frustrado' | 'satisfeito' | 'urgente';

export type HandoffPayload = {
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerPlan: string;
  conversationId: string;
  sentiment: Sentiment;
  resumo: string;
  ticketLinearId?: string;
};

export type HandoffBackend = {
  postHandoff: (payload: HandoffPayload & { lastMessages: string[] }) => Promise<void>;
};

const SENTIMENT_EMOJI: Record<Sentiment, string> = {
  neutro: '😐',
  satisfeito: '😊',
  frustrado: '😟',
  urgente: '🚨',
};

export function renderSlackBlocks(p: HandoffPayload & { lastMessages: string[] }) {
  const emoji = SENTIMENT_EMOJI[p.sentiment];
  const msgList = p.lastMessages.map((m, i) => `${i + 1}. ${m}`).join('\n');
  const ticketLine = p.ticketLinearId ? `🎫 ${p.ticketLinearId} vinculado\n` : '';
  return {
    text: `Handoff WhatsApp — ${p.customerName}`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `🚨 Handoff WhatsApp — Nova / Onyx Telecom` },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Cliente*\n${p.customerName}` },
          { type: 'mrkdwn', text: `*Telefone*\n${p.customerPhone}` },
          { type: 'mrkdwn', text: `*Plano*\n${p.customerPlan}` },
          { type: 'mrkdwn', text: `*Sentimento*\n${emoji} ${p.sentiment.toUpperCase()}` },
        ],
      },
      { type: 'section', text: { type: 'mrkdwn', text: `${ticketLine}*Resumo*\n${p.resumo}` } },
      { type: 'section', text: { type: 'mrkdwn', text: `*Últimas mensagens*\n${msgList}` } },
    ],
  };
}

export async function escalateHumanHandoff(db: DbClient, slack: HandoffBackend, p: HandoffPayload) {
  const lastMessages = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.conversationId, p.conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(3);

  const formatted = lastMessages
    .reverse()
    .map((m) => `[${m.role}] ${m.content.slice(0, 80)}${m.content.length > 80 ? '…' : ''}`);

  await slack.postHandoff({ ...p, lastMessages: formatted });

  await db
    .update(conversations)
    .set({ humanTakeoverAt: new Date(), lastSentiment: p.sentiment })
    .where(eq(conversations.id, p.conversationId));

  await db.insert(auditLog).values({
    customerId: p.customerId,
    action: 'escalar_atendente',
    payload: { sentiment: p.sentiment, conversationId: p.conversationId },
    result: 'ok',
  });
}
