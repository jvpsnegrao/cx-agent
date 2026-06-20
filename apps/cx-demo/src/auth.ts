import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { env } from './env.ts';

const COOKIE_NAME = 'cx_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function sign(payload: string): string {
  return createHmac('sha256', env.sessionSecret).update(payload).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function issueSession(c: Context): void {
  const ts = Date.now().toString();
  const sig = sign(ts);
  const cookie = `${ts}.${sig}`;
  setCookie(c, COOKIE_NAME, cookie, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSession(c: Context): void {
  deleteCookie(c, COOKIE_NAME, { path: '/' });
}

export function validateSession(c: Context): boolean {
  const cookie = getCookie(c, COOKIE_NAME);
  if (!cookie) return false;
  const [ts, sig] = cookie.split('.');
  if (!ts || !sig) return false;
  const expected = sign(ts);
  if (!safeEqual(sig, expected)) return false;
  const issued = Number(ts);
  if (!Number.isFinite(issued)) return false;
  if (Date.now() - issued > SESSION_TTL_MS) return false;
  return true;
}

export function verifyPassword(input: string): boolean {
  // Lê process.env.CX_DEMO_PASSWORD dinamicamente pra suportar testes que setam
  // a senha após o import do módulo (env.ts captura no top-level).
  const expected = process.env.CX_DEMO_PASSWORD ?? env.password;
  return safeEqual(input, expected);
}

export const requireBearer: MiddlewareHandler = async (c, next) => {
  const expected = process.env.CX_DEMO_TOKEN ?? env.token;
  const auth = c.req.header('authorization') ?? '';
  // EXIGE prefixo Bearer — segurança: cabeçalhos sem prefixo (token bare)
  // são rejeitados pra evitar confusão entre auth schemes.
  if (!/^Bearer\s+/i.test(auth)) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!expected || !token || !safeEqual(token, expected)) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  await next();
};

export const requireSession: MiddlewareHandler = async (c, next) => {
  if (!validateSession(c)) {
    return c.redirect('/login');
  }
  await next();
};
