import { env } from './env.ts';

// Lidas dinamicamente a cada chamada pra suportar testes que mockam env
// depois do import do módulo.
const omniUrl = () => process.env.OMNI_API_URL ?? 'http://localhost:8882';
const omniKey = () => process.env.OMNI_API_KEY ?? '';
const omniInstance = () => process.env.OMNI_INSTANCE_ID ?? env.omniInstanceId;

/**
 * Manda mensagem WhatsApp pro cliente via Omni REST API.
 * Reusa o mesmo padrão do cx-cron/reminder.ts.
 * No-op silencioso se OMNI_API_KEY ou OMNI_INSTANCE_ID não estiverem setados
 * (modo dev sem WhatsApp conectado).
 */
export async function notifyCustomer(phone: string, text: string): Promise<{ ok: boolean; error?: string }> {
  if (!omniKey() || !omniInstance()) {
    return { ok: false, error: 'OMNI_API_KEY ou OMNI_INSTANCE_ID não setados — notificação WhatsApp desabilitada' };
  }
  try {
    const res = await fetch(`${omniUrl()}/api/v2/messages/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': omniKey() },
      body: JSON.stringify({ instanceId: omniInstance(), to: phone, text }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `omni ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Manda mídia (PDF/imagem/áudio/vídeo) via Omni `/messages/send/media`.
 * Aceita URL pública (Omni baixa) — preferido ao base64.
 */
export async function notifyCustomerMedia(opts: {
  phone: string;
  type: 'document' | 'image' | 'audio' | 'video';
  url?: string;
  base64?: string;
  filename?: string;
  caption?: string;
  mimeType?: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!omniKey() || !omniInstance()) {
    return { ok: false, error: 'OMNI_API_KEY ou OMNI_INSTANCE_ID não setados' };
  }
  if (!opts.url && !opts.base64) {
    return { ok: false, error: 'precisa de url ou base64' };
  }
  try {
    const res = await fetch(`${omniUrl()}/api/v2/messages/send/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': omniKey() },
      body: JSON.stringify({
        instanceId: omniInstance(),
        to: opts.phone,
        type: opts.type,
        ...(opts.url ? { url: opts.url } : {}),
        ...(opts.base64 ? { base64: opts.base64 } : {}),
        filename: opts.filename,
        caption: opts.caption,
        mimeType: opts.mimeType,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `omni ${res.status}: ${body.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
