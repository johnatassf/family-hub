import { type CoreEnv, flag, isLocalUrl } from './env';

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
}

/** "Nome <email@x>" → { name, email }. Aceita também só o e-mail. */
export function parseAddress(value: string): { name?: string; email: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(value);
  if (!m) return { email: value.trim() };
  const name = m[1]!.trim();
  return name ? { name, email: m[2]!.trim() } : { email: m[2]!.trim() };
}

/** Erros do provedor vão só para o log (o handler da API devolve mensagem genérica). */
async function providerError(provider: string, res: Response) {
  return new Error(`${provider} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

/**
 * Envia e-mail pelo primeiro provedor configurado: Cloudflare Email Service (binding EMAIL),
 * Resend (RESEND_API_KEY) ou Brevo (BREVO_API_KEY).
 * Em dev local (DEV_EMAIL_OUTBOX=true e APP_URL em localhost) grava no KV e no console.
 */
export async function sendEmail(env: CoreEnv, message: OutgoingEmail): Promise<void> {
  if (flag(env.DEV_EMAIL_OUTBOX) && isLocalUrl(env.APP_URL)) {
    console.log(`[dev-email] para=${message.to} assunto="${message.subject}"\n${message.text}`);
    await env.KV.put(devOutboxKey(message.to), JSON.stringify(message), { expirationTtl: 900 });
    return;
  }
  const from = env.EMAIL_FROM;
  if (!from) throw new Error('EMAIL_FROM não configurado');

  if (env.EMAIL) {
    await env.EMAIL.send({ from, to: message.to, subject: message.subject, text: message.text });
    return;
  }
  if (env.RESEND_API_KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text }),
    });
    if (!res.ok) throw await providerError('Resend', res);
    return;
  }
  if (env.BREVO_API_KEY) {
    // API transacional (não o SMTP): a chave é a "API key" do Brevo (xkeysib-...), não a chave SMTP.
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ sender: parseAddress(from), to: [{ email: message.to }], subject: message.subject, textContent: message.text }),
    });
    if (!res.ok) throw await providerError('Brevo', res);
    return;
  }
  throw new Error('Nenhum provedor de e-mail configurado (binding EMAIL, RESEND_API_KEY ou BREVO_API_KEY)');
}

export const devOutboxKey = (to: string) => `dev:outbox:${to.toLowerCase()}`;
