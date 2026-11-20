import { Hono } from 'hono';
import { z } from 'zod';
import { type Me, type PublicConfig, isManager } from '@familia/shared';
import { hasVerifiedTotp } from './auth';
import { flag } from './env';
import {
  changeRole,
  createInvite,
  ensureMemberships,
  listAudit,
  listInvites,
  listMembers,
  removeMember,
  renameHousehold,
  revokeInvite,
} from './households';
import { type AppEnv, parseJson, requireAdmin2FA, requireHousehold, requireUser } from './middleware';
import { clientIp } from './util';

const inviteSchema = z.object({
  email: z.email().max(254),
  role: z.enum(['admin', 'member']).default('member'),
});
const roleSchema = z.object({ role: z.enum(['owner', 'admin', 'member']) });
const renameSchema = z.object({ name: z.string().trim().min(2).max(80) });

export function coreRoutes() {
  const api = new Hono<AppEnv>();

  api.get('/public-config', (c) =>
    c.json<PublicConfig>({
      appName: c.env.APP_NAME ?? 'Família',
      turnstileSiteKey: c.env.TURNSTILE_SITE_KEY && c.env.TURNSTILE_SECRET_KEY ? c.env.TURNSTILE_SITE_KEY : null,
      googleEnabled: Boolean(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET),
      openSignup: flag(c.env.ALLOW_OPEN_SIGNUP),
    }),
  );

  api.get('/me', requireUser, async (c) => {
    const user = c.var.user!;
    const households = await ensureMemberships(c.env, user, {
      ip: clientIp(c.req.raw),
      userAgent: c.req.header('user-agent') ?? null,
    });
    const twoFactorRequired =
      flag(c.env.REQUIRE_ADMIN_2FA, true) && !user.twoFactorEnabled && households.some((h) => isManager(h.role));
    const twoFactorMethod = !user.twoFactorEnabled ? null : (await hasVerifiedTotp(c.env.DB, user.id)) ? 'totp' : 'email';
    return c.json<Me>({ user, households, twoFactorRequired, twoFactorMethod });
  });

  const household = new Hono<AppEnv>();
  household.use('*', requireUser, requireHousehold, requireAdmin2FA);

  household.get('/', async (c) => {
    const ctx = c.var.ctx;
    const [members, invites] = await Promise.all([
      listMembers(c.env.DB, ctx.householdId),
      isManager(ctx.role) ? listInvites(c.env.DB, ctx.householdId) : Promise.resolve([]),
    ]);
    const row = await c.env.DB.prepare(`SELECT name FROM households WHERE id = ?`).bind(ctx.householdId).first<{ name: string }>();
    return c.json({ id: ctx.householdId, name: row?.name ?? '', role: ctx.role, members, invites });
  });

  household.patch('/', async (c) => {
    const { name } = await parseJson(c.req.raw, renameSchema);
    await renameHousehold(c.env.DB, c.var.ctx, name);
    return c.json({ ok: true });
  });

  household.post('/invites', async (c) => {
    const { email, role } = await parseJson(c.req.raw, inviteSchema);
    return c.json(await createInvite(c.env, c.var.ctx, email, role), 201);
  });

  household.delete('/invites/:id', async (c) => {
    await revokeInvite(c.env.DB, c.var.ctx, c.req.param('id'));
    return c.json({ ok: true });
  });

  household.patch('/members/:userId', async (c) => {
    const { role } = await parseJson(c.req.raw, roleSchema);
    await changeRole(c.env.DB, c.var.ctx, c.req.param('userId'), role);
    return c.json({ ok: true });
  });

  household.delete('/members/:userId', async (c) => {
    await removeMember(c.env, c.var.ctx, c.req.param('userId'));
    return c.json({ ok: true });
  });

  household.get('/audit', async (c) => c.json(await listAudit(c.env.DB, c.var.ctx)));

  api.route('/household', household);
  return api;
}
