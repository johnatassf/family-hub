import type { ErrorHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import { secureHeaders } from 'hono/secure-headers';
import type { z } from 'zod';
import { HOUSEHOLD_HEADER, isManager } from '@familia/shared';
import { type Auth, createAuth } from './auth';
import { type CoreEnv, flag } from './env';
import { type RequestCtx, ensureMemberships, listMemberships } from './households';
import { AppError, clientIp, errorJson, fail } from './util';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
}

export type CoreVariables = {
  auth: Auth;
  user: SessionUser | null;
  ctx: RequestCtx;
};

export type AppEnv<B extends CoreEnv = CoreEnv> = { Bindings: B; Variables: CoreVariables };

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Headers de segurança das respostas da API (as páginas usam public/_headers). */
export const apiSecurityHeaders = () => [
  secureHeaders({
    contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    strictTransportSecurity: 'max-age=31536000; includeSubDomains',
    xFrameOptions: 'DENY',
    referrerPolicy: 'strict-origin-when-cross-origin',
    crossOriginResourcePolicy: 'same-origin',
  }),
  createMiddleware(async (c, next) => {
    await next();
    if (!c.res.headers.has('Cache-Control')) c.res.headers.set('Cache-Control', 'no-store');
  }),
];

/**
 * Proteção CSRF: toda requisição que altera dados precisa vir da origem do próprio app.
 * Navegadores sempre enviam Origin em POST/PATCH/DELETE.
 */
export const originGuard = createMiddleware<AppEnv>(async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) return next();
  const expected = new URL(c.env.APP_URL).origin;
  if (c.req.header('origin') !== expected) return errorJson(c, 403, 'BAD_ORIGIN', 'Origem da requisição não permitida.');
  await next();
});

/** Uma instância do Better Auth por requisição (D1 e waitUntil vêm do contexto). */
export const withAuth = createMiddleware<AppEnv>(async (c, next) => {
  c.set('auth', createAuth(c.env, (p) => c.executionCtx.waitUntil(p)));
  await next();
});

/** Camada 1 de rate limit nas rotas de login: 10 POST/min por IP (binding do Workers). */
export const authRateLimit = createMiddleware<AppEnv>(async (c, next) => {
  if (c.req.method === 'POST' && c.env.RL_AUTH) {
    const { success } = await c.env.RL_AUTH.limit({ key: `auth:${clientIp(c.req.raw)}` });
    if (!success) return errorJson(c, 429, 'RATE_LIMITED', 'Muitas tentativas. Aguarde um minuto e tente de novo.');
  }
  await next();
});

export const loadSession = createMiddleware<AppEnv>(async (c, next) => {
  const result = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
  const u = result?.user as (Record<string, unknown> & { id: string; name: string; email: string }) | undefined;
  c.set(
    'user',
    u
      ? {
          id: u.id,
          name: u.name,
          email: u.email,
          image: (u.image as string | null) ?? null,
          emailVerified: Boolean(u.emailVerified),
          twoFactorEnabled: Boolean(u.twoFactorEnabled),
        }
      : null,
  );
  await next();
});

/** Camada 1 de rate limit no restante da API: 120 req/min por usuário (ou por IP, sem sessão). */
export const apiRateLimit = createMiddleware<AppEnv>(async (c, next) => {
  if (c.env.RL_API) {
    const key = c.var.user ? `user:${c.var.user.id}` : `ip:${clientIp(c.req.raw)}`;
    const { success } = await c.env.RL_API.limit({ key });
    if (!success) return errorJson(c, 429, 'RATE_LIMITED', 'Muitas requisições. Aguarde um pouco.');
  }
  await next();
});

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.var.user) return errorJson(c, 401, 'UNAUTHENTICATED', 'Faça login para continuar.');
  await next();
});

/**
 * Resolve a família ativa: a do cabeçalho X-Household-Id (só se o usuário for membro) ou a primeira.
 * O householdId nunca é aceito do cliente sem essa checagem.
 */
export const requireHousehold = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.var.user;
  if (!user) return errorJson(c, 401, 'UNAUTHENTICATED', 'Faça login para continuar.');
  let memberships = await listMemberships(c.env.DB, user.id);
  // Sem família ainda: aceita convites pendentes / cria a família de bootstrap (o mesmo que GET /api/me faz).
  if (!memberships.length) {
    memberships = await ensureMemberships(c.env, user, { ip: clientIp(c.req.raw), userAgent: c.req.header('user-agent') ?? null });
  }
  const requested = c.req.header(HOUSEHOLD_HEADER);
  const active = requested ? memberships.find((m) => m.id === requested) : memberships[0];
  if (!active) return errorJson(c, 403, 'NO_HOUSEHOLD', 'Você ainda não faz parte desta família.');
  c.set('ctx', {
    userId: user.id,
    householdId: active.id,
    role: active.role,
    ip: clientIp(c.req.raw),
    userAgent: c.req.header('user-agent') ?? null,
  });
  await next();
});

/** Dono(a) e administradores precisam de 2FA ativo para usar a plataforma. */
export const requireAdmin2FA = createMiddleware<AppEnv>(async (c, next) => {
  const required = flag(c.env.REQUIRE_ADMIN_2FA, true);
  if (required && isManager(c.var.ctx.role) && !c.var.user?.twoFactorEnabled) {
    return errorJson(c, 403, 'TWO_FACTOR_REQUIRED', 'Ative a verificação em duas etapas para continuar.');
  }
  await next();
});

export async function parseJson<S extends z.ZodType>(req: Request, schema: S): Promise<z.output<S>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, 'VALIDATION', 'Corpo da requisição inválido.');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(400, 'VALIDATION', issue ? `${issue.path.join('.') || 'corpo'}: ${issue.message}` : 'Dados inválidos.');
  }
  return parsed.data;
}

export const handleError: ErrorHandler<AppEnv> = (err, c) => {
  if (err instanceof AppError) return errorJson(c, err.status, err.code, err.message);
  console.error('[api] erro não tratado', err);
  return errorJson(c, 500, 'INTERNAL', 'Erro interno. Tente novamente.');
};
