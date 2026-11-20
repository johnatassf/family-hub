import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type CoreEnv, parseAddress, sendEmail } from '@familia/core';

/** Ambiente "de produção" com só o Brevo configurado (sem binding EMAIL nem Resend). */
const brevoEnv = (): CoreEnv => ({
  ...(env as unknown as CoreEnv),
  APP_URL: 'https://familia-hub.exemplo.workers.dev',
  DEV_EMAIL_OUTBOX: 'false',
  EMAIL_FROM: 'Família <familia.teste@gmail.com>',
  BREVO_API_KEY: 'xkeysib-teste',
  RESEND_API_KEY: undefined,
  EMAIL: undefined,
});

const message = { to: 'ana@teste.local', subject: 'Seu código de acesso', text: 'Seu código é 123456' };

afterEach(() => vi.restoreAllMocks());

describe('envio de e-mail pelo Brevo', () => {
  it('usa a API transacional com a chave no header api-key', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"messageId":"<1@brevo>"}', { status: 201 }));
    await sendEmail(brevoEnv(), message);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(new Headers(init?.headers).get('api-key')).toBe('xkeysib-teste');
    expect(JSON.parse(String(init?.body))).toEqual({
      sender: { name: 'Família', email: 'familia.teste@gmail.com' },
      to: [{ email: 'ana@teste.local' }],
      subject: 'Seu código de acesso',
      textContent: 'Seu código é 123456',
    });
  });

  it('erro do Brevo leva o status e o motivo (para o log)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"code":"unauthorized","message":"Key not found"}', { status: 401 }));
    await expect(sendEmail(brevoEnv(), message)).rejects.toThrow('Brevo HTTP 401: {"code":"unauthorized","message":"Key not found"}');
  });

  it('sem nenhum provedor configurado, avisa quais faltam', async () => {
    await expect(sendEmail({ ...brevoEnv(), BREVO_API_KEY: undefined }, message)).rejects.toThrow('BREVO_API_KEY');
  });
});

describe('parseAddress', () => {
  it.each([
    ['Família <familia@gmail.com>', { name: 'Família', email: 'familia@gmail.com' }],
    ['"Família Silva" <familia@gmail.com>', { name: 'Família Silva', email: 'familia@gmail.com' }],
    ['<familia@gmail.com>', { email: 'familia@gmail.com' }],
    ['familia@gmail.com', { email: 'familia@gmail.com' }],
  ])('%s', (input, expected) => {
    expect(parseAddress(input)).toEqual(expected);
  });
});
