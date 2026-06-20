import { sql } from 'drizzle-orm';
import { db } from './db.ts';
import { emitStream } from './events.ts';
import { updateSentimentFromMessage } from './sentiment.ts';

const POLL_MS = 2000;
const SEEN_CAP = 1000;

type Row = {
  id: string;
  is_from_me: boolean;
  text_content: string | null;
  created_at: Date | string;
  khal_conv_id: string | null;
};

/**
 * Omni grava TODAS as msgs (incoming + outgoing) em public.messages, mas só publica
 * incoming no NATS. Esse poll detecta msgs novas (outgoing principalmente) e emite
 * SSE message_in/message_out pro painel atualizar em tempo real.
 *
 * Dedupe por id (não por timestamp) porque drizzle execute pode retornar string ou
 * Date dependendo da query, e timestamp string-compare gera bugs sutis.
 */
export async function startOmniPoll(): Promise<void> {
  const seen = new Set<string>();
  // semente inicial: marca todas as msgs existentes como já vistas (não floodar SSE no boot)
  const initial = await db.execute<{ id: string }>(sql`SELECT id::text FROM public.messages`);
  for (const r of initial) seen.add(r.id);
  console.log(`[omni-poll] iniciando — ${seen.size} msgs já vistas no boot`);

  setInterval(async () => {
    try {
      const rows = await db.execute<Row>(sql`
        SELECT
          m.id::text,
          m.is_from_me,
          m.text_content,
          m.created_at,
          (
            SELECT conv.id::text FROM khal.conversations conv
            JOIN khal.customers cust ON cust.id = conv.customer_id
            WHERE
              regexp_replace(ch.canonical_id, '@.*', '') = regexp_replace(cust.phone, '\\+', '')
              OR regexp_replace(ch.external_id, '@.*', '') = regexp_replace(cust.phone, '\\+', '')
            ORDER BY conv.started_at DESC
            LIMIT 1
          ) AS khal_conv_id
        FROM public.messages m
        JOIN public.chats ch ON ch.id = m.chat_id
        WHERE m.created_at > now() - interval '2 minutes'
        ORDER BY m.created_at ASC
        LIMIT 50
      `);

      for (const r of rows) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        if (!r.khal_conv_id) continue;
        emitStream({
          type: r.is_from_me ? 'message_out' : 'message_in',
          conversationId: r.khal_conv_id,
          content: r.text_content ?? '',
        });
        // Sentiment analysis nas msgs do cliente (is_from_me=false)
        if (!r.is_from_me && r.text_content) {
          await updateSentimentFromMessage(r.khal_conv_id, r.text_content).catch(() => {
            /* não-crítico */
          });
        }
      }

      // Evita memória crescer indefinida — drop metade dos mais antigos
      if (seen.size > SEEN_CAP) {
        const arr = Array.from(seen);
        seen.clear();
        for (const id of arr.slice(arr.length / 2)) seen.add(id);
      }
    } catch (err) {
      console.error('[omni-poll] erro', err instanceof Error ? err.message : err);
    }
  }, POLL_MS);
}
