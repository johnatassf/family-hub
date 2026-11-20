import { Hono } from 'hono';
import type { ModuleHooks } from '@familia/core';
import {
  type AppEnv,
  apiRateLimit,
  apiSecurityHeaders,
  authRateLimit,
  coreRoutes,
  errorJson,
  handleError,
  loadSession,
  originGuard,
  registerModuleHooks,
  requireAdmin2FA,
  requireHousehold,
  requireUser,
  withAuth,
} from '@familia/core';
import { type FinanceEnv, financeModule } from '@familia/finance/server';
import { storeModule } from '@familia/store/server';

/** Bindings do Worker: núcleo + todos os módulos. */
export type Env = FinanceEnv;

/**
 * Contrato de um módulo do servidor. Cada módulo tipa o próprio contexto do Hono por dentro
 * (ex.: a loja acrescenta a empresa ativa), por isso aqui o tipo das rotas é aberto.
 */
interface PlatformModule {
  id: string;
  basePath: string;
  // biome-ignore lint/suspicious/noExplicitAny: cada módulo tem o seu Env do Hono.
  routes: () => Hono<any, any, any>;
  hooks: ModuleHooks;
  scheduled?: (env: Env) => Promise<void>;
}

/** Módulos da plataforma. Um módulo novo entra aqui e no menu do React (src/web/modules.ts). */
const modules: PlatformModule[] = [financeModule, storeModule];
for (const m of modules) registerModuleHooks(m.hooks);

const app = new Hono<AppEnv<Env>>();

app.use('/api/*', ...apiSecurityHeaders(), originGuard, withAuth);

// Rotas do Better Auth (login, cadastro, 2FA, OTP, Google). Rate limit por IP antes.
app.use('/api/auth/*', authRateLimit);
app.on(['GET', 'POST'], '/api/auth/*', (c) => c.var.auth.handler(c.req.raw));

app.use('/api/*', loadSession, apiRateLimit);
app.route('/api', coreRoutes());

for (const m of modules) {
  app.use(`/api${m.basePath}/*`, requireUser, requireHousehold, requireAdmin2FA);
  app.route(`/api${m.basePath}`, m.routes());
}

app.all('/api/*', (c) => errorJson(c, 404, 'NOT_FOUND', 'Rota não encontrada.'));
app.onError(handleError);

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    for (const m of modules) if (m.scheduled) ctx.waitUntil(m.scheduled(env));
  },
} satisfies ExportedHandler<Env>;
