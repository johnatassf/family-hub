import { createMiddleware } from 'hono/factory';
import { type CoreEnv, type CoreVariables, errorJson, fail } from '@familia/core';
import type { BizRole } from '../shared';

export interface BizCtx {
  businessId: string;
  userId: string;
  role: BizRole;
}

export type StoreEnv = { Bindings: CoreEnv; Variables: CoreVariables & { biz: BizCtx } };

/**
 * A empresa só existe para os membros dela (nem a família vê por padrão).
 * Quem não é membro recebe 404, sem revelar que a empresa existe.
 */
export const requireBusiness = createMiddleware<StoreEnv>(async (c, next) => {
  const bid = c.req.param('bid');
  const ctx = c.var.ctx;
  const row = bid
    ? await c.env.DB.prepare(
        `SELECT m.role FROM biz_members m JOIN biz_businesses b ON b.id = m.business_id
          WHERE m.business_id = ? AND m.user_id = ? AND b.household_id = ?`,
      )
        .bind(bid, ctx.userId, ctx.householdId)
        .first<{ role: BizRole }>()
    : null;
  if (!row) return errorJson(c, 404, 'NOT_FOUND', 'Empresa não encontrada.');
  c.set('biz', { businessId: bid!, userId: ctx.userId, role: row.role });
  await next();
});

export const canWrite = (biz: BizCtx) => {
  if (biz.role === 'viewer') fail(403, 'FORBIDDEN', 'Você só tem acesso de visualização nesta empresa.');
};

export const isBizOwner = (biz: BizCtx) => {
  if (biz.role !== 'owner') fail(403, 'FORBIDDEN', 'Só a dona(o) da empresa pode fazer isso.');
};

/** Data de hoje no fuso de Brasília (AAAA-MM-DD). */
export const todayBR = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now);
