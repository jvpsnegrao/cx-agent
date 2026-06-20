import { eq, sql } from 'drizzle-orm';
import { conversations } from '@khal/db';
import { db } from './db.ts';
import type { Sentiment } from './types.ts';

const URGENT = [
  /\burgent\w*/i,
  /\bemerg[êe]nci\w*/i,
  /\bimediat\w*/i,
  /\bpreciso (agora|j[áa])(?:\b|$)/i,
  /\bn[ãa]o (aguent|posso esperar|posso mais)\w*/i,
  /\bcad[êe] vcs\b/i,
  /\bperdendo (cliente|grana|dinheiro|venda)\w*/i,
  /\bagora!|agora\.\.\./i,
  /🚨|⚠️|🆘/u,
];

const ANGRY = [
  // Raiva direta
  /\bput\w*/i, /\bpistol\w*/i, /\bbrav\w*/i, /\braiv\w*/i,
  /\bvacila[çc]\w*/i, /\babsurd\w*/i,
  /\bhorr[íi]vel/i, /\bp[ée]ssim\w*/i,
  /\bmerd\w*/i, /\bporcari\w*/i, /\bdroga\b/i, /\bbosta\b/i,
  /\bdecep[çc]\w*/i, /\bridícul\w*|ridiculo\w*/i,
  /\bsaco\b/i, /\bcansado\b/i, /\bcansei/i, /\binsanidade/i,
  /\bla[d]r(ão|ões|ona|ao|oes|aos)\w*/i, /\bot[áa]ri\w*/i, /\bfilhos? d[ae]/i,
  /\bcanc(elar|elei|elando|ela|elamos)\b/i,
  /(?:^|\s)[óo]di(o|ar|os|ada|ados)\b/i,
  /\broub(o|ado|ar|ando|ada|os)\b/i,
  /\bdesisti?(o|u|ndo)?\b/i,
  /\bvou (na|no) (vivo|claro|tim|oi|outra|rival|concorr\w*)/i,
  /\b(s[óo] )?perd(o|e|er|i|emos|endo) (tempo|grana|dinheiro|vendas?|cliente)/i,
  /\b(j[aá]\s+)?(t[ôo]|estou)\s+h[áa]\s+\d+\s+(min|hora|dia)/i,
  // Reclamação produto (PT-BR coloquial)
  /\bn[ãa]o (funciona|funcionou|liga|conecta|abre|carrega|baixa)\w*/i,
  /\b(ta|t[áa])\s+(\w+\s+)?(ruim|lent[ao]|p[ée]ssim[ao]|horr[íi]vel|quebrad[ao]|caind[ao])/i,
  /\bcaiu\b|caindo\b|cai (toda hora|sempre|de novo)/i,
  /\batras(ou|ada|ado|ando)/i,
  /\bdemor(ou|a|am|ando|ad[ao]|nte)\b/i,
  /\berra(do|da|ndo)\b/i, /\bbug(ad[ao])?\b/i,
  /\bn[ãa]o (consigo|aguento)\b/i,
  /\bpiorou\b|\bpiorando\b/i,
  /\bsem (sinal|internet|conex[ãa]o|rede|net)\b/i,
  /\binternet\s+(ta|t[áa])?\s*(lenta|ruim|fora|caiu)/i,
  /\bnet\s+(ta|t[áa])?\s*(lenta|ruim|fora|caiu)/i,
  // Pontuação raivosa
  /😡|😠|🤬|😤|😞|🙄|😒|💢|:@@|:@/u,
  /!{2,}/, // 2+ exclamações
];

const HAPPY = [
  /\bobrigad\w*/i, /\bvaleu\b/i,
  /(?:^|\s)[óo]tim\w*/i, /(?:^|\s)perfeit\w*/i,
  /\bresolv\w*/i, /\bajud(ou|aram)\w*/i,
  /\blegal\b/i, /\bmaravilh\w*/i,
  /\bsensac\w*/i, /\bshow\b/i,
  /\bbom demais|bom mesmo|tudo certo/i,
  /\bgostei\b/i, /\bamei\b/i, /\bfunfou\b/i,
  /😊|😀|😁|😄|👍|🙌|❤️|🤝|🙏|✨|💯/u,
];

export function analyzeSentiment(text: string): Sentiment {
  const t = text?.trim() ?? '';
  if (!t) return 'neutro';
  if (URGENT.some((r) => r.test(t))) return 'urgente';
  if (ANGRY.some((r) => r.test(t))) return 'frustrado';
  if (HAPPY.some((r) => r.test(t))) return 'satisfeito';
  // CAPS-LOCK sustained
  const letters = t.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (letters.length > 5 && letters === letters.toUpperCase()) return 'frustrado';
  return 'neutro';
}

const WEIGHT: Record<Sentiment, number> = { neutro: 0, satisfeito: 1, frustrado: 2, urgente: 3 };

/**
 * Recalcula sentiment olhando as ÚLTIMAS 5 msgs do cliente, com peso por recência
 * (mais nova = peso 5, antiga = 1). Resolve o caso "cliente reclama por 4 msgs,
 * agradece na última e vira satisfeito" — agora frustrado prevalece.
 */
export async function updateSentimentFromMessage(
  conversationId: string,
  _latestText: string,
): Promise<Sentiment> {
  const rows = await db.execute<{ text_content: string | null }>(sql`
    SELECT m.text_content
    FROM public.messages m
    JOIN public.chats ch ON ch.id = m.chat_id
    JOIN khal.conversations conv ON conv.id = ${conversationId}::uuid
    JOIN khal.customers cust ON cust.id = conv.customer_id
    WHERE m.is_from_me = false
      AND (
        regexp_replace(ch.canonical_id, '@.*', '') = regexp_replace(cust.phone, '\\+', '')
        OR regexp_replace(ch.external_id, '@.*', '') = regexp_replace(cust.phone, '\\+', '')
      )
    ORDER BY m.created_at DESC
    LIMIT 5
  `);

  // Score por sentiment × peso por recência × peso por intensidade do sentiment
  const score: Record<Sentiment, number> = { neutro: 0, satisfeito: 0, frustrado: 0, urgente: 0 };
  rows.forEach((r, i) => {
    if (!r.text_content) return;
    const s = analyzeSentiment(r.text_content);
    const recency = 5 - i; // recente=5, antiga=1
    const intensity = WEIGHT[s] + 1; // frustrado pesa mais que satisfeito
    score[s] += recency * intensity;
  });

  // Dominante (excluindo neutro se houver alternativa)
  let dominant: Sentiment = 'neutro';
  let max = 0;
  (['urgente', 'frustrado', 'satisfeito', 'neutro'] as Sentiment[]).forEach((k) => {
    if (score[k] > max) {
      max = score[k];
      dominant = k;
    }
  });

  // Tie-breaker: se neutro empata com não-neutro, escolhe não-neutro pior
  if (dominant === 'neutro' && score.frustrado + score.urgente > 0) {
    dominant = score.urgente > score.frustrado ? 'urgente' : 'frustrado';
  }

  await db
    .update(conversations)
    .set({ lastSentiment: dominant })
    .where(eq(conversations.id, conversationId));
  return dominant;
}
