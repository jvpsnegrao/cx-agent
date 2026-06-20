/**
 * notify.ts — testa serialização do body, escolha da rota e tratamento de
 * erro do Omni REST. Usa mock fetch (sem rede). Env vars setadas antes do
 * import pra que o módulo capture os valores corretos.
 */
process.env.OMNI_API_URL = 'http://omni-mock.local:9999';
process.env.OMNI_API_KEY = 'mock-omni-key';
process.env.OMNI_INSTANCE_ID = 'mock-inst-uuid';

import { describe, expect, it, mock } from 'bun:test';
import { notifyCustomer, notifyCustomerMedia } from '../src/notify.ts';

type CallRecord = { url: string; body: Record<string, unknown>; headers: Record<string, string> };

function fakeFetch(status: number, body: unknown, captures: CallRecord[]) {
  const m = mock(async (url: string | URL | Request, init?: RequestInit) => {
    const headers = init?.headers ? Object.fromEntries(new Headers(init.headers)) : {};
    captures.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? '{}')),
      headers,
    });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  });
  // Substitui global fetch só pra essa run
  const orig = globalThis.fetch;
  globalThis.fetch = m as unknown as typeof fetch;
  return () => {
    globalThis.fetch = orig;
  };
}

describe('notifyCustomer — text', () => {
  it('POSTa em /api/v2/messages/send com to + text + instanceId', async () => {
    const caps: CallRecord[] = [];
    const reset = fakeFetch(200, { messageId: 'msg-1' }, caps);
    try {
      const r = await notifyCustomer('+5511999990001', 'oi cliente');
      expect(r.ok).toBe(true);
      expect(caps).toHaveLength(1);
      expect(caps[0]!.url).toBe('http://omni-mock.local:9999/api/v2/messages/send');
      expect(caps[0]!.body).toEqual({
        instanceId: 'mock-inst-uuid',
        to: '+5511999990001',
        text: 'oi cliente',
      });
      expect(caps[0]!.headers['x-api-key']).toBe('mock-omni-key');
    } finally {
      reset();
    }
  });

  it('retorna ok=false com mensagem quando Omni responde 4xx', async () => {
    const caps: CallRecord[] = [];
    const reset = fakeFetch(400, { error: 'bad request' }, caps);
    try {
      const r = await notifyCustomer('+5500000000000', 'x');
      expect(r.ok).toBe(false);
      expect(r.error).toContain('omni 400');
    } finally {
      reset();
    }
  });

  it('retorna ok=false em erro de rede', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('econnrefused');
    }) as unknown as typeof fetch;
    try {
      const r = await notifyCustomer('+5511999990001', 'x');
      expect(r.ok).toBe(false);
      expect(r.error).toContain('econnrefused');
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe('notifyCustomerMedia — anexo', () => {
  it('POSTa /send/media com type=document, base64 e mimeType', async () => {
    const caps: CallRecord[] = [];
    const reset = fakeFetch(200, { messageId: 'msg-2' }, caps);
    try {
      const r = await notifyCustomerMedia({
        phone: '+5511999990001',
        type: 'document',
        base64: 'JVBERi0xLjcK', // %PDF-1.7 base64-ish
        filename: 'boleto.pdf',
        caption: 'sua 2ª via',
        mimeType: 'application/pdf',
      });
      expect(r.ok).toBe(true);
      expect(caps[0]!.url).toBe('http://omni-mock.local:9999/api/v2/messages/send/media');
      const body = caps[0]!.body as Record<string, unknown>;
      expect(body.type).toBe('document');
      expect(body.base64).toBe('JVBERi0xLjcK');
      expect(body.url).toBeUndefined();
      expect(body.filename).toBe('boleto.pdf');
      expect(body.mimeType).toBe('application/pdf');
    } finally {
      reset();
    }
  });

  it('aceita url alternativa em vez de base64', async () => {
    const caps: CallRecord[] = [];
    const reset = fakeFetch(200, {}, caps);
    try {
      await notifyCustomerMedia({
        phone: '+5511999990001',
        type: 'image',
        url: 'https://example.com/img.png',
        caption: 'foto',
      });
      const body = caps[0]!.body as Record<string, unknown>;
      expect(body.url).toBe('https://example.com/img.png');
      expect(body.base64).toBeUndefined();
    } finally {
      reset();
    }
  });

  it('falha quando nem url nem base64 são fornecidos', async () => {
    const r = await notifyCustomerMedia({
      phone: '+5511999990001',
      type: 'document',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('url ou base64');
  });

  it('propaga erro 5xx do Omni com mensagem clara', async () => {
    const caps: CallRecord[] = [];
    const reset = fakeFetch(
      502,
      { error: { code: 'CHANNEL_SEND_FAILED', message: 'whatsapp down' } },
      caps,
    );
    try {
      const r = await notifyCustomerMedia({
        phone: '+5500000000000',
        type: 'document',
        base64: 'JVBERi0=',
      });
      expect(r.ok).toBe(false);
      expect(r.error).toContain('omni 502');
      expect(r.error).toContain('CHANNEL_SEND_FAILED');
    } finally {
      reset();
    }
  });
});
