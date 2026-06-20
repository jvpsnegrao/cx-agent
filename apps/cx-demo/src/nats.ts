import { connect, StringCodec, type NatsConnection } from 'nats';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { conversations, customers } from '@khal/db';
import { db } from './db.ts';
import { emitStream } from './events.ts';
import { env } from './env.ts';
import { updateSentimentFromMessage } from './sentiment.ts';

const sc = StringCodec();

let nc: NatsConnection | null = null;

export async function startNatsSubscriber(): Promise<void> {
  if (!env.omniInstanceId) {
    console.warn('[nats] OMNI_INSTANCE_ID não setada — subscriber desabilitado');
    return;
  }

  try {
    nc = await connect({ servers: env.natsUrl, name: 'cx-demo', reconnect: true });
  } catch (err) {
    console.error('[nats] não conectou em', env.natsUrl, err instanceof Error ? err.message : err);
    return;
  }

  console.log('[nats] conectado em', env.natsUrl);

  // Subscribe amplo: ouvimos TODO tráfego "omni.>" e classificamos por subject.
  // Razão: Omni publica msgs incoming em omni.message.*, mas msgs outgoing podem
  // vir em omni.reply.*, omni.outgoing.*, omni.event.outgoing.* — depende da versão.
  const sub = nc.subscribe('omni.>');
  console.log('[nats] subscribe omni.>');

  (async () => {
    for await (const msg of sub) {
      try {
        const subject = msg.subject;
        const raw = sc.decode(msg.data);
        const data = safeJson(raw) as Record<string, unknown>;
        const role = classifyRole(subject);
        if (!role) {
          // log uma vez por subject pra ajudar descobrir novos topics
          logUnknown(subject);
          continue;
        }
        const content = extractContent(data);
        const chatId = extractChatId(subject) ?? extractChatIdFromPayload(data);
        if (!content || !chatId) continue;
        await persistAndEmit(role, content, chatId);
      } catch (err) {
        console.error('[nats] erro processando msg', err);
      }
    }
  })();
}

const seenUnknown = new Set<string>();
function logUnknown(subject: string): void {
  // colapsa o último segmento (chat id) pra não floodar
  const collapsed = subject.split('.').slice(0, 4).join('.') + '.*';
  if (seenUnknown.has(collapsed)) return;
  seenUnknown.add(collapsed);
  console.log(`[nats] subject ignorado (não classifiquei como msg): ${collapsed}`);
}

function classifyRole(subject: string): 'customer' | 'nova' | null {
  // omni.message.<inst>.<chat>           — msg do cliente entrou
  // omni.reply.<inst>.<chat>             — reply do agente (em algumas versões)
  // omni.outgoing.<inst>.<chat>          — outra grafia possível
  // omni.event.message.received.<...>    — eventos novos do Omni
  // omni.event.message.sent.<...>        — eventos novos do Omni
  if (subject.startsWith('omni.message.')) return 'customer';
  if (subject.startsWith('omni.reply.')) return 'nova';
  if (subject.startsWith('omni.outgoing.')) return 'nova';
  if (subject.startsWith('omni.event.message.received.')) return 'customer';
  if (subject.startsWith('omni.event.message.sent.')) return 'nova';
  return null;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return { content: s };
  }
}

function extractContent(data: Record<string, unknown>): string {
  const candidates = ['content', 'text', 'message', 'body', 'caption'] as const;
  for (const k of candidates) {
    const v = data[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  // payload aninhado (ex.: {message:{text:"..."}} ou {data:{content:"..."}})
  const nestedKeys = ['message', 'payload', 'data'] as const;
  for (const k of nestedKeys) {
    const v = data[k];
    if (v && typeof v === 'object') {
      const inner = extractContent(v as Record<string, unknown>);
      if (inner) return inner;
    }
  }
  return '';
}

function extractChatId(subject: string): string | null {
  const parts = subject.split('.');
  // omni.X.<inst>.<chat...>  → joins from index 3
  if (parts.length < 4) return null;
  return parts.slice(3).join('.');
}

function extractChatIdFromPayload(data: Record<string, unknown>): string | null {
  const candidates = ['chatId', 'chat_id', 'from', 'to', 'jid'] as const;
  for (const k of candidates) {
    const v = data[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

function chatIdToPhone(chatId: string): string | null {
  const atIdx = chatId.indexOf('@');
  const head = atIdx === -1 ? chatId : chatId.slice(0, atIdx);
  const digits = head.split(':')[0]?.replace(/[^0-9]/g, '') ?? '';
  if (!digits) return null;
  return `+${digits}`;
}

async function persistAndEmit(
  role: 'customer' | 'nova',
  content: string,
  chatId: string,
): Promise<void> {
  // Lookup canonical phone (E.164 real) em public.chats. O subject do NATS traz
  // só external_id (ex.: "15809908895839@lid"), mas o customer real está sob o
  // canonical_id (ex.: "553496605400@s.whatsapp.net").
  const canonical = await resolveCanonicalChat(chatId);
  const phone = chatIdToPhone(canonical);
  if (!phone) return;

  let customer = (await db.select().from(customers).where(eq(customers.phone, phone)).limit(1))[0];

  if (!customer) {
    // NÃO auto-cria mais customer placeholder pra incoming msg.
    // Onboarding via Nova decide cadastrar — auto-create polui khal.customers
    // e confunde a Nova (vê "cliente existente sem plano" e pula onboarding).
    // Conversa ainda pode aparecer no painel se o phone bater com customer real;
    // se não, a msg só vive em public.messages do Omni até a Nova guiar o cadastro.
    console.log(`[nats] phone ${phone} não cadastrado — Nova vai guiar onboarding`);
    return;
  }

  let [convo] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.customerId, customer.id), isNull(conversations.humanTakeoverAt)))
    .orderBy(desc(conversations.startedAt))
    .limit(1);

  if (!convo) {
    [convo] = await db.insert(conversations).values({ customerId: customer.id }).returning();
    if (!convo) return;
  }

  // Não grava em khal.messages — fonte da verdade é public.messages do Omni.
  // omni-poll cuida do persist+emit. Aqui só emit pra latência menor no incoming.
  emitStream({
    type: role === 'customer' ? 'message_in' : 'message_out',
    conversationId: convo.id,
    content,
  });

  // Sentiment analysis só pra incoming (msg do cliente)
  if (role === 'customer') {
    await updateSentimentFromMessage(convo.id, content).catch(() => {
      /* não-crítico */
    });
  }
}

async function resolveCanonicalChat(externalChatId: string): Promise<string> {
  const rows = await db.execute<{ canonical_id: string | null }>(sql`
    SELECT canonical_id FROM public.chats WHERE external_id = ${externalChatId} LIMIT 1
  `);
  const canonical = rows[0]?.canonical_id;
  return canonical && canonical.length > 0 ? canonical : externalChatId;
}

export async function closeNats(): Promise<void> {
  if (nc) {
    await nc.drain();
    nc = null;
  }
}
