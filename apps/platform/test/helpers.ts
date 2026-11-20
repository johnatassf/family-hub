import { SELF, env } from 'cloudflare:test';
import { devOutboxKey } from '@familia/core';

export const ORIGIN = 'http://localhost';
export const PASSWORD = 'senha-bem-forte-123';

export interface Session {
  cookie: string;
  userId: string;
  email: string;
  household?: string;
}

type ApiInit = Omit<RequestInit, 'body'> & { body?: unknown; session?: Session | string; household?: string; origin?: string | null };

/** Chama a API como um navegador da própria origem (Origin + cookie de sessão). */
export async function api(path: string, init: ApiInit = {}) {
  const headers = new Headers(init.headers);
  // IP aleatório por chamada para os testes não esbarrarem no rate limit uns dos outros.
  if (!headers.has('cf-connecting-ip')) headers.set('cf-connecting-ip', `198.51.100.${Math.floor(Math.random() * 250) + 1}`);
  if (init.origin !== null) headers.set('Origin', init.origin ?? ORIGIN);
  const cookie = typeof init.session === 'string' ? init.session : init.session?.cookie;
  if (cookie) headers.set('Cookie', cookie);
  const household = init.household ?? (typeof init.session === 'object' ? init.session.household : undefined);
  if (household) headers.set('X-Household-Id', household);
  let body: BodyInit | undefined;
  if (init.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.body);
  }
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers, body, redirect: 'manual' });
}

export async function json<T = any>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Junta os Set-Cookie de uma resposta num header Cookie. */
export function cookiesFrom(res: Response, previous = ''): string {
  const jar = new Map(
    previous
      .split('; ')
      .filter(Boolean)
      .map((kv) => [kv.split('=')[0]!, kv] as const),
  );
  for (const sc of res.headers.getSetCookie()) {
    const kv = sc.split(';')[0]!;
    const name = kv.split('=')[0]!;
    if (kv.endsWith('=') || /max-age=0/i.test(sc)) jar.delete(name);
    else jar.set(name, kv);
  }
  return [...jar.values()].join('; ');
}

/** Lê o último e-mail da caixa de saída de dev (o envio roda em waitUntil, então espera um pouco). */
export async function lastEmail(email: string, tries = 40): Promise<{ subject: string; text: string } | null> {
  for (let i = 0; i < tries; i++) {
    const raw = await env.KV.get(devOutboxKey(email));
    if (raw) {
      await env.KV.delete(devOutboxKey(email));
      return JSON.parse(raw);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  return null;
}

export async function lastCode(email: string): Promise<string> {
  const mail = await lastEmail(email);
  const code = mail?.text.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error(`nenhum código enviado para ${email}: ${JSON.stringify(mail)}`);
  return code;
}

/** Cadastro com senha → confirma e-mail pelo código → login. */
export async function signUp(email: string, name: string): Promise<Session> {
  const res = await api('/api/auth/sign-up/email', { method: 'POST', body: { email, name, password: PASSWORD } });
  if (!res.ok) throw new Error(`sign-up ${res.status}: ${await res.text()}`);
  const otp = await lastCode(email);
  const verify = await api('/api/auth/email-otp/verify-email', { method: 'POST', body: { email, otp } });
  if (!verify.ok) throw new Error(`verify ${verify.status}: ${await verify.text()}`);
  return signIn(email);
}

export async function signIn(email: string): Promise<Session> {
  const res = await api('/api/auth/sign-in/email', { method: 'POST', body: { email, password: PASSWORD } });
  if (!res.ok) throw new Error(`sign-in ${res.status}: ${await res.text()}`);
  const cookie = cookiesFrom(res);
  const me = await json(await api('/api/me', { session: cookie }));
  return { cookie, userId: me.user.id, email, household: me.households[0]?.id };
}

// ---------- TOTP (RFC 6238), igual a um app autenticador ----------

function base32Decode(input: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = input.replace(/=+$/, '').toUpperCase();
  let bits = '';
  for (const ch of clean) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return bytes;
}

export async function totp(secretBase32: string, at = Date.now()): Promise<string> {
  const counter = Math.floor(at / 1000 / 30);
  const msg = new ArrayBuffer(8);
  new DataView(msg).setUint32(4, counter);
  const key = await crypto.subtle.importKey('raw', base32Decode(secretBase32), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const offset = mac[mac.length - 1]! & 0xf;
  const bin = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(bin % 1_000_000).padStart(6, '0');
}

/** Ativa 2FA (TOTP) e devolve a sessão atualizada + o segredo. */
export async function enableTotp(s: Session): Promise<Session & { secret: string }> {
  const res = await api('/api/auth/two-factor/enable', { method: 'POST', session: s, body: { password: PASSWORD } });
  if (!res.ok) throw new Error(`2fa enable ${res.status}: ${await res.text()}`);
  const { totpURI } = await json<{ totpURI: string }>(res);
  const secret = new URL(totpURI).searchParams.get('secret')!;
  let cookie = cookiesFrom(res, s.cookie);
  const verify = await api('/api/auth/two-factor/verify-totp', { method: 'POST', session: cookie, body: { code: await totp(secret) } });
  if (!verify.ok) throw new Error(`2fa verify ${verify.status}: ${await verify.text()}`);
  cookie = cookiesFrom(verify, cookie);
  return { ...s, cookie, secret };
}

/** Dono(a) bootstrap já com 2FA ativo. */
export async function ownerWith2fa(email = 'dono@teste.local', name = 'Ana Dona') {
  return enableTotp(await signUp(email, name));
}

export async function invite(owner: Session, email: string, role: 'member' | 'admin' = 'member') {
  const res = await api('/api/household/invites', { method: 'POST', session: owner, body: { email, role } });
  if (res.status !== 201) throw new Error(`invite ${res.status}: ${await res.text()}`);
  await lastEmail(email); // descarta o e-mail do convite
}
