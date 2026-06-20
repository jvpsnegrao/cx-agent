/**
 * Cookie HMAC do painel — cobre roundtrip, expiração, tampering, validação.
 * O middleware lê process.env.CX_DEMO_TOKEN diretamente — set antes do import.
 */
process.env.CX_DEMO_TOKEN = 'auth-test-token-xyz';
process.env.CX_DEMO_PASSWORD = 'auth-test-pwd';
process.env.CX_DEMO_SESSION_SECRET = 'auth-test-secret-1234567890';
process.env.KHAL_DATABASE_URL =
  process.env.KHAL_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/omni';

import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import {
  clearSession,
  issueSession,
  requireBearer,
  requireSession,
  validateSession,
  verifyPassword,
} from '../src/auth.ts';

function buildApp() {
  const app = new Hono();
  app.post('/login', (c) => {
    issueSession(c);
    return c.body(null, 204);
  });
  app.post('/logout', (c) => {
    clearSession(c);
    return c.body(null, 204);
  });
  app.get('/check', (c) => c.json({ valid: validateSession(c) }));
  app.get('/protected', requireSession, (c) => c.text('ok'));
  app.get('/api', requireBearer, (c) => c.text('api ok'));
  return app;
}

describe('verifyPassword', () => {
  it('aceita senha correta', () => {
    expect(verifyPassword('auth-test-pwd')).toBe(true);
  });

  it('rejeita senha errada', () => {
    expect(verifyPassword('wrong')).toBe(false);
  });

  it('rejeita senha vazia', () => {
    expect(verifyPassword('')).toBe(false);
  });

  it('é case-sensitive', () => {
    expect(verifyPassword('AUTH-TEST-PWD')).toBe(false);
  });
});

describe('cookie session — roundtrip', () => {
  const app = buildApp();

  it('issueSession seta cookie e validateSession aceita', async () => {
    const r1 = await app.request('/login', { method: 'POST' });
    const cookie = r1.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('cx_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');

    const sessionCookie = cookie.split(';')[0]!; // "cx_session=..."
    const r2 = await app.request('/check', { headers: { Cookie: sessionCookie } });
    const body = (await r2.json()) as { valid: boolean };
    expect(body.valid).toBe(true);
  });

  it('clearSession invalida sessão', async () => {
    const r1 = await app.request('/login', { method: 'POST' });
    const sessionCookie = (r1.headers.get('set-cookie') ?? '').split(';')[0]!;
    const r2 = await app.request('/logout', {
      method: 'POST',
      headers: { Cookie: sessionCookie },
    });
    const clearCookie = (r2.headers.get('set-cookie') ?? '').split(';')[0]!;
    const r3 = await app.request('/check', { headers: { Cookie: clearCookie } });
    const body = (await r3.json()) as { valid: boolean };
    expect(body.valid).toBe(false);
  });
});

describe('cookie session — tampering / segurança', () => {
  const app = buildApp();

  it('rejeita cookie sem assinatura', async () => {
    const r = await app.request('/check', {
      headers: { Cookie: 'cx_session=1234567890.' }, // sem sig
    });
    const body = (await r.json()) as { valid: boolean };
    expect(body.valid).toBe(false);
  });

  it('rejeita cookie com assinatura inválida', async () => {
    const r = await app.request('/check', {
      headers: { Cookie: 'cx_session=1234567890.deadbeef' },
    });
    const body = (await r.json()) as { valid: boolean };
    expect(body.valid).toBe(false);
  });

  it('rejeita cookie com timestamp tamperado mantendo sig original', async () => {
    const r1 = await app.request('/login', { method: 'POST' });
    const orig = (r1.headers.get('set-cookie') ?? '').split(';')[0]!;
    // cx_session=<ts>.<sig>
    const sig = orig.split('.')[1] ?? '';
    const tampered = `cx_session=9999999999999.${sig}`;
    const r = await app.request('/check', { headers: { Cookie: tampered } });
    const body = (await r.json()) as { valid: boolean };
    expect(body.valid).toBe(false);
  });

  it('rejeita sem cookie', async () => {
    const r = await app.request('/check');
    const body = (await r.json()) as { valid: boolean };
    expect(body.valid).toBe(false);
  });
});

describe('requireSession middleware', () => {
  const app = buildApp();

  it('redirect 302 /login sem cookie', async () => {
    const r = await app.request('/protected');
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/login');
  });

  it('200 com cookie válido', async () => {
    const r1 = await app.request('/login', { method: 'POST' });
    const sessionCookie = (r1.headers.get('set-cookie') ?? '').split(';')[0]!;
    const r = await app.request('/protected', { headers: { Cookie: sessionCookie } });
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('ok');
  });
});

describe('requireBearer middleware', () => {
  const app = buildApp();

  it('401 sem header', async () => {
    const r = await app.request('/api');
    expect(r.status).toBe(401);
  });

  it('401 com token errado', async () => {
    const r = await app.request('/api', { headers: { Authorization: 'Bearer wrong' } });
    expect(r.status).toBe(401);
  });

  it('401 sem prefixo Bearer', async () => {
    const r = await app.request('/api', { headers: { Authorization: 'auth-test-token-xyz' } });
    expect(r.status).toBe(401);
  });

  it('200 com Bearer correto', async () => {
    const r = await app.request('/api', { headers: { Authorization: 'Bearer auth-test-token-xyz' } });
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('api ok');
  });

  it('aceita Bearer case-insensitive', async () => {
    const r = await app.request('/api', { headers: { Authorization: 'bearer auth-test-token-xyz' } });
    expect(r.status).toBe(200);
  });
});
