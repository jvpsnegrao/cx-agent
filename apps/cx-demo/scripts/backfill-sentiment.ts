#!/usr/bin/env bun
/**
 * Reprocessa sentiment de todas as conversas baseado nas msgs históricas
 * do cliente em public.messages.
 *
 * Rodar: `bun apps/cx-demo/scripts/backfill-sentiment.ts`
 */
import { sql } from 'drizzle-orm';
import { db } from '../src/db.ts';
import { analyzeSentiment } from '../src/sentiment.ts';
import type { Sentiment } from '../src/types.ts';

const PRIORITY: Record<Sentiment, number> = {
  neutro: 0,
  satisfeito: 1,
  frustrado: 2,
  urgente: 3,
};

const rows = await db.execute<{ conv_id: string; phone: string }>(sql`
  SELECT conv.id::text AS conv_id, cust.phone
  FROM khal.conversations conv
  JOIN khal.customers cust ON cust.id = conv.customer_id
`);

console.log(`backfill: processando ${rows.length} conversas`);

let touched = 0;
for (const r of rows) {
  const msgs = await db.execute<{ text_content: string | null }>(sql`
    SELECT m.text_content
    FROM public.messages m
    JOIN public.chats ch ON ch.id = m.chat_id
    WHERE m.is_from_me = false
      AND (
        regexp_replace(ch.canonical_id, '@.*', '') = regexp_replace(${r.phone}, '\\+', '')
        OR regexp_replace(ch.external_id, '@.*', '') = regexp_replace(${r.phone}, '\\+', '')
      )
    ORDER BY m.created_at DESC
    LIMIT 30
  `);

  let strongest: Sentiment = 'neutro';
  for (const m of msgs) {
    if (!m.text_content) continue;
    const s = analyzeSentiment(m.text_content);
    if (PRIORITY[s] > PRIORITY[strongest]) strongest = s;
  }

  if (strongest !== 'neutro') {
    await db.execute(sql`
      UPDATE khal.conversations SET last_sentiment = ${strongest} WHERE id = ${r.conv_id}::uuid
    `);
    touched++;
    console.log(`  ${r.phone} → ${strongest}`);
  }
}

console.log(`backfill: ${touched} conversas atualizadas`);
process.exit(0);
