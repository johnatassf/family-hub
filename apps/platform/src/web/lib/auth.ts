// Chamadas aos endpoints do Better Auth (/api/auth/*). Mesma origem, cookie HttpOnly.

export class AuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'E-mail ou senha incorretos.',
  EMAIL_NOT_VERIFIED: 'Confirme seu e-mail antes de entrar.',
  INVALID_OTP: 'Código inválido.',
  OTP_EXPIRED: 'Código expirado. Peça um novo.',
  TOO_MANY_ATTEMPTS: 'Muitas tentativas com este código. Peça um novo.',
  INVALID_TWO_FACTOR_CODE: 'Código do app autenticador inválido.',
  INVALID_CODE: 'Código inválido.',
  OTP_HAS_EXPIRED: 'Código expirado. Peça um novo.',
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: 'Muitas tentativas com este código. Peça um novo.',
  INVALID_TWO_FACTOR_COOKIE: 'A verificação expirou. Volte e entre de novo.',
  ACCOUNT_TEMPORARILY_LOCKED: 'Muitas tentativas erradas. Aguarde alguns minutos e tente de novo.',
  PASSWORD_TOO_SHORT: 'A senha precisa ter pelo menos 10 caracteres.',
  INVALID_PASSWORD: 'Senha incorreta.',
  SESSION_EXPIRED: 'Sua sessão é antiga para essa ação. Saia e entre de novo.',
  MISSING_RESPONSE: 'Confirme que você não é um robô.',
  VERIFICATION_FAILED: 'Falha na verificação anti-robô. Tente de novo.',
};

export async function authCall<T = Record<string, unknown>>(
  path: string,
  body?: Record<string, unknown>,
  opts: { captcha?: string | null; method?: 'GET' | 'POST' } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (opts.captcha) headers['x-captcha-response'] = opts.captcha;
  const res = await fetch(`/api/auth${path}`, {
    method: opts.method ?? (body ? 'POST' : 'GET'),
    headers,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const code: string | undefined = data?.code;
    const message = (code && MESSAGES[code]) || data?.message || data?.error || `Erro ${res.status}`;
    throw new AuthError(res.status, code, res.status === 429 ? 'Muitas tentativas. Aguarde um minuto.' : message);
  }
  return data as T;
}

export const signOut = () => authCall('/sign-out', {});
