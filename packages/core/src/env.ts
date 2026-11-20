/** Bindings e variáveis usados pelo núcleo. Módulos estendem com os seus. */
export interface CoreEnv {
  DB: D1Database;
  KV: KVNamespace;
  /** Rate limit por IP nas rotas de login (POST /api/auth/*). */
  RL_AUTH?: RateLimit;
  /** Rate limit por usuário (ou IP) no restante de /api/*. */
  RL_API?: RateLimit;
  /** Cloudflare Email Service. Ausente em dev local. */
  EMAIL?: SendEmail;

  /** Origem pública do app, ex.: https://familia.exemplo.com.br */
  APP_URL: string;
  APP_NAME?: string;
  EMAIL_FROM?: string;

  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  /** Alternativa ao Email Service: https://resend.com (3 mil e-mails/mês grátis; exige domínio próprio). */
  RESEND_API_KEY?: string;
  /** Alternativa sem domínio próprio: https://brevo.com (300 e-mails/dia grátis). EMAIL_FROM = remetente verificado lá. */
  BREVO_API_KEY?: string;

  /** E-mails (separados por vírgula) que podem criar a primeira família sem convite. */
  BOOTSTRAP_OWNER_EMAILS?: string;
  /** "true" libera cadastro aberto: cada pessoa nova ganha a própria família. */
  ALLOW_OPEN_SIGNUP?: string;
  /** "false" desliga a exigência de 2FA para dono/admin (só para desenvolvimento). */
  REQUIRE_ADMIN_2FA?: string;
  /** "true" grava e-mails no KV e no console em vez de enviar. Só funciona com APP_URL em localhost. */
  DEV_EMAIL_OUTBOX?: string;
}

export const flag = (value: string | undefined, fallback = false) =>
  value === undefined || value === '' ? fallback : value.toLowerCase() === 'true';

export const isLocalUrl = (url: string) => {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
};
