import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { PASSWORD, api, cookiesFrom, enableTotp, invite, json, lastEmail, ownerWith2fa, signIn, signUp, totp } from './helpers';

describe('cadastro fechado (só convite)', () => {
  it('recusa cadastro de e-mail sem convite (sem revelar isso na resposta)', async () => {
    const res = await api('/api/auth/sign-up/email', {
      method: 'POST',
      body: { email: 'intruso@teste.local', name: 'Intruso', password: PASSWORD },
    });
    // Better Auth responde de forma genérica (anti-enumeração); o que importa é não criar a conta.
    expect((await json(res)).token).toBeNull();
    const row = await env.DB.prepare(`SELECT 1 FROM "user" WHERE email = ?`).bind('intruso@teste.local').first();
    expect(row).toBeNull();
    expect(await lastEmail('intruso@teste.local', 10)).toBeNull();
  });

  it('não envia código de login para e-mail sem conta e sem convite', async () => {
    const res = await api('/api/auth/email-otp/send-verification-otp', {
      method: 'POST',
      body: { email: 'ninguem@teste.local', type: 'sign-in' },
    });
    expect(res.status).toBe(200); // mesma resposta: não revela se a conta existe
    expect(await lastEmail('ninguem@teste.local', 10)).toBeNull();
  });

  it('dono bootstrap ganha a família e convidado entra nela', async () => {
    const owner = await ownerWith2fa();
    const me = await json(await api('/api/me', { session: owner }));
    expect(me.households).toHaveLength(1);
    expect(me.households[0].role).toBe('owner');
    expect(me.twoFactorRequired).toBe(false);

    await invite(owner, 'bia@teste.local');
    const bia = await signUp('bia@teste.local', 'Bia Membro');
    const meBia = await json(await api('/api/me', { session: bia }));
    expect(meBia.households).toEqual([{ id: owner.household, name: 'Família de Ana', role: 'member' }]);
  });
});

describe('2FA obrigatório para dono/admin', () => {
  it('bloqueia a família até ativar o 2FA', async () => {
    const owner = await signUp('dono@teste.local', 'Ana Dona');
    const me = await json(await api('/api/me', { session: owner }));
    expect(me.twoFactorRequired).toBe(true);

    const blocked = await api('/api/household', { session: owner });
    expect(blocked.status).toBe(403);
    expect((await json(blocked)).code).toBe('TWO_FACTOR_REQUIRED');
    expect((await api('/api/finance/summary', { session: owner })).status).toBe(403);

    const withTotp = await enableTotp(owner);
    expect((await api('/api/household', { session: withTotp })).status).toBe(200);
  });

  it('login por senha passa a pedir o código do app autenticador', async () => {
    const owner = await ownerWith2fa();
    const first = await api('/api/auth/sign-in/email', { method: 'POST', body: { email: owner.email, password: PASSWORD } });
    expect(first.status).toBe(200);
    expect((await json(first)).twoFactorRedirect).toBe(true);
    const pending = cookiesFrom(first);
    expect((await api('/api/me', { session: pending })).status).toBe(401); // ainda sem sessão

    const second = await api('/api/auth/two-factor/verify-totp', {
      method: 'POST',
      session: pending,
      body: { code: await totp(owner.secret, Date.now() + 30_000) },
    });
    expect(second.status).toBe(200);
    expect((await api('/api/me', { session: cookiesFrom(second, pending) })).status).toBe(200);
  });

  it('quem tem 2FA não entra só com código de e-mail', async () => {
    const owner = await ownerWith2fa();
    const send = await api('/api/auth/email-otp/send-verification-otp', { method: 'POST', body: { email: owner.email, type: 'sign-in' } });
    expect(send.status).toBe(200);
    const mail = await lastEmail(owner.email);
    expect(mail?.subject).toContain('desativado');
    expect(mail?.text).not.toMatch(/\b\d{6}\b/);

    const signIn = await api('/api/auth/sign-in/email-otp', { method: 'POST', body: { email: owner.email, otp: '123456' } });
    expect(signIn.status).toBe(403);
  });
});

describe('proteções de borda', () => {
  it('recusa alteração vinda de outra origem (CSRF)', async () => {
    const owner = await ownerWith2fa();
    const res = await api('/api/household/invites', {
      method: 'POST',
      session: owner,
      origin: 'https://site-malicioso.example',
      body: { email: 'x@teste.local' },
    });
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('BAD_ORIGIN');
    const noOrigin = await api('/api/household/invites', { method: 'POST', session: owner, origin: null, body: { email: 'x@teste.local' } });
    expect(noOrigin.status).toBe(403);
  });

  it('limita tentativas de login (429)', async () => {
    await signUp('dono@teste.local', 'Ana Dona');
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await api('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'cf-connecting-ip': '203.0.113.9' },
        body: { email: 'dono@teste.local', password: 'senha-errada-000' },
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 3).every((s) => s === 401)).toBe(true);
    expect(statuses).toContain(429);
  });

  it('API exige sessão e devolve headers de segurança', async () => {
    const res = await api('/api/finance/summary');
    expect(res.status).toBe(401);
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('não aceita família de outra pessoa pelo cabeçalho', async () => {
    const owner = await ownerWith2fa();
    await env.DB.prepare(`INSERT INTO households (id, name, created_at) VALUES ('hh_outra', 'Outra', '2026-01-01')`).run();
    const res = await api('/api/finance/summary', { session: owner, household: 'hh_outra' });
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('NO_HOUSEHOLD');
  });

  it('signIn helper funciona sem 2FA para membro', async () => {
    const owner = await ownerWith2fa();
    await invite(owner, 'caio@teste.local');
    await signUp('caio@teste.local', 'Caio');
    const again = await signIn('caio@teste.local');
    expect(again.household).toBe(owner.household);
  });
});
