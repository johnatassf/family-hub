import { Hono } from 'hono';
import { z } from 'zod';
import { type AppEnv, listMembers, parseJson } from '@familia/core';
import type { TxFilters } from './access';
import { type FinanceEnv, pluggyFromEnv } from './env';
import { registerPlanningRoutes } from './planning-routes';
import * as svc from './service';

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'use AAAA-MM');
const id = z.string().min(1).max(100);

const filtersSchema = z.object({
  scope: z.enum(['all', 'mine', 'family']).optional(),
  member: id.optional(),
  accountId: id.optional(),
  month: month.optional(),
  category: z.string().max(60).optional(),
  review: z.enum(['1', '0']).optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const txPatchSchema = z
  .object({
    category: z.string().min(1).max(60).optional(),
    referenceMonth: month.optional(),
    excluded: z.boolean().optional(),
    assignedUserId: id.nullable().optional(),
  })
  .strict();

const accountPatchSchema = z
  .object({ visibility: z.enum(['private', 'family']).optional(), nickname: z.string().max(60).nullable().optional() })
  .strict();

const addItemSchema = z.object({
  pluggyItemId: z.string().trim().regex(/^[\w-]{8,100}$/, 'itemId inválido'),
  ownerUserId: id.optional(),
});

const ruleSchema = z.object({ pattern: z.string().trim().min(2).max(60), category: z.string().min(1).max(60) });
const categorySchema = z.object({ name: z.string().trim().min(2).max(40) });

const parseFilters = (query: Record<string, string>) => {
  const parsed = filtersSchema.safeParse(query);
  const f = parsed.success ? parsed.data : {};
  const filters: TxFilters = { ...f, review: f.review === '1' };
  return { filters, limit: f.limit, offset: f.offset };
};

export function financeRoutes() {
  const r = new Hono<AppEnv<FinanceEnv>>();

  r.get('/summary', async (c) => c.json(await svc.summary(c.env.DB, c.var.ctx, parseFilters(c.req.query()).filters)));

  r.get('/transactions', async (c) => {
    const { filters, limit, offset } = parseFilters(c.req.query());
    return c.json(await svc.listTransactions(c.env.DB, c.var.ctx, filters, limit, offset));
  });

  r.patch('/transactions/:id', async (c) => {
    await svc.editTransaction(c.env.DB, c.var.ctx, c.req.param('id'), await parseJson(c.req.raw, txPatchSchema));
    return c.json({ ok: true });
  });

  r.get('/export.csv', async (c) => {
    const csv = await svc.exportCsv(c.env.DB, c.var.ctx, parseFilters(c.req.query()).filters);
    return c.body(csv, 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="transacoes.csv"',
    });
  });

  r.get('/accounts', async (c) => c.json(await svc.listAccounts(c.env.DB, c.var.ctx)));

  r.patch('/accounts/:id', async (c) => {
    await svc.updateAccount(c.env.DB, c.var.ctx, c.req.param('id'), await parseJson(c.req.raw, accountPatchSchema));
    return c.json({ ok: true });
  });

  r.get('/members', async (c) => {
    const members = await listMembers(c.env.DB, c.var.ctx.householdId);
    return c.json(members.map((m) => ({ userId: m.userId, name: m.name })));
  });

  r.get('/items', async (c) => c.json(await svc.listItems(c.env.DB, c.var.ctx)));

  r.post('/items', async (c) => {
    const input = await parseJson(c.req.raw, addItemSchema);
    return c.json(await svc.addItem(c.env, c.var.ctx, () => pluggyFromEnv(c.env), input), 201);
  });

  r.delete('/items/:id', async (c) => {
    const revoke = c.req.query('revoke') === '1';
    await svc.removeItem(c.env, c.var.ctx, revoke ? pluggyFromEnv(c.env) : null, c.req.param('id'), revoke);
    return c.json({ ok: true });
  });

  /** ?full=1 busca o histórico inteiro de novo; sem ele, só o que mudou desde a última vez. */
  r.post('/items/:id/sync', async (c) =>
    c.json(await svc.syncOne(c.env, c.var.ctx, () => pluggyFromEnv(c.env), c.req.param('id'), { full: c.req.query('full') === '1' })),
  );

  /** Sincroniza todas as conexões da própria pessoa. */
  r.post('/sync', async (c) => {
    const pluggy = pluggyFromEnv(c.env);
    const items = (await svc.listItems(c.env.DB, c.var.ctx)).filter((i) => i.isMine);
    const results = [];
    for (const item of items) {
      try {
        results.push(await svc.syncOne(c.env, c.var.ctx, () => pluggy, item.id));
      } catch (e) {
        results.push({ itemId: item.id, processed: 0, accounts: 0, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return c.json(results);
  });

  r.get('/categories', async (c) => c.json(await svc.listCategories(c.env.DB, c.var.ctx)));

  r.post('/categories', async (c) => {
    const { name } = await parseJson(c.req.raw, categorySchema);
    await svc.addCategory(c.env.DB, c.var.ctx, name);
    return c.json({ ok: true }, 201);
  });

  r.post('/rules', async (c) => {
    const { pattern, category } = await parseJson(c.req.raw, ruleSchema);
    await svc.addRule(c.env.DB, c.var.ctx, pattern, category);
    return c.json({ ok: true }, 201);
  });

  r.delete('/rules/:id', async (c) => {
    await svc.deleteRule(c.env.DB, c.var.ctx, Number(c.req.param('id')));
    return c.json({ ok: true });
  });

  registerPlanningRoutes(r);
  return r;
}

