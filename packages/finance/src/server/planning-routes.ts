import type { Hono } from 'hono';
import { z } from 'zod';
import { type AppEnv, parseJson } from '@familia/core';
import { currentMonth, monthDiff } from '../planning';
import type { FinanceEnv } from './env';
import * as goals from './goals-service';
import * as plan from './planning-service';

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'use AAAA-MM');
const cents = z.number().int().min(1).max(1_000_000_000_00);
const id = z.string().min(1).max(100);
const visibility = z.enum(['private', 'family']);
const name = z.string().trim().min(1).max(80);

const entrySchema = z
  .object({
    kind: z.enum(['income', 'expense']),
    name,
    amountCents: cents,
    frequency: z.enum(['monthly', 'yearly', 'once']),
    monthOfYear: z.number().int().min(1).max(12).nullable().optional(),
    startMonth: month,
    endMonth: month.nullable().optional(),
    visibility: visibility.default('private'),
  })
  .strict();

const settingsSchema = z
  .object({
    commitLimitPct: z.number().int().min(5).max(100).optional(),
    variableOverrideCents: z.number().int().min(0).max(1_000_000_000_00).nullable().optional(),
    cardMonth: z.enum(['bill', 'purchase']).optional(),
  })
  .strict();

const goalSchema = z
  .object({
    kind: z.enum(['purchase', 'trip', 'reserve', 'other']),
    name,
    targetCents: cents,
    targetMonth: month,
    visibility: visibility.default('family'),
    status: z.enum(['active', 'done', 'archived']).optional(),
    notes: z.string().max(500).nullable().optional(),
  })
  .strict();

const contributionSchema = z
  .object({
    amountCents: z.number().int().min(-1_000_000_000_00).max(1_000_000_000_00).refine((v) => v !== 0, 'valor não pode ser zero'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .strict();

const itemSchema = z.object({ name, amountCents: cents }).strict();

const projectionQuery = z.object({
  scope: z.enum(['family', 'mine']).default('family'),
  months: z.coerce.number().int().min(3).max(36).default(12),
  simAmount: z.coerce.number().int().min(1).max(1_000_000_000_00).optional(),
  simInstallments: z.coerce.number().int().min(1).max(48).optional(),
  simStart: month.optional(),
});

const installmentsQuery = z.object({
  scope: z.enum(['all', 'mine', 'family']).optional(),
  member: id.optional(),
  accountId: id.optional(),
  months: z.coerce.number().int().min(3).max(36).default(12),
});

const query = <S extends z.ZodType>(schema: S, q: Record<string, string>) => {
  const r = schema.safeParse(q);
  return (r.success ? r.data : schema.parse({})) as z.output<S>;
};

export function registerPlanningRoutes(r: Hono<AppEnv<FinanceEnv>>) {
  // Parcelas e faturas
  r.get('/installments', async (c) => {
    const q = query(installmentsQuery, c.req.query());
    return c.json(await plan.getInstallments(c.env.DB, c.var.ctx, q, q.months));
  });
  r.get('/accounts/:id/bills', async (c) => c.json(await plan.listBills(c.env.DB, c.var.ctx, c.req.param('id'))));

  // Rendas e gastos fixos
  r.get('/plan/entries', async (c) => c.json(await plan.listEntries(c.env.DB, c.var.ctx)));
  r.post('/plan/entries', async (c) => c.json(await plan.createEntry(c.env.DB, c.var.ctx, await parseJson(c.req.raw, entrySchema)), 201));
  r.patch('/plan/entries/:id', async (c) => {
    await plan.updateEntry(c.env.DB, c.var.ctx, c.req.param('id'), await parseJson(c.req.raw, entrySchema.partial()));
    return c.json({ ok: true });
  });
  r.delete('/plan/entries/:id', async (c) => {
    await plan.deleteEntry(c.env.DB, c.var.ctx, c.req.param('id'));
    return c.json({ ok: true });
  });
  r.get('/plan/suggestions', async (c) => c.json(await plan.getSuggestions(c.env.DB, c.var.ctx)));

  // Parâmetros e projeção
  r.get('/plan/settings', async (c) => c.json(await plan.getSettings(c.env.DB, c.var.ctx.householdId)));
  r.patch('/plan/settings', async (c) => {
    await plan.updateSettings(c.env.DB, c.var.ctx, await parseJson(c.req.raw, settingsSchema));
    return c.json({ ok: true });
  });
  r.get('/plan/projection', async (c) => {
    const q = query(projectionQuery, c.req.query());
    const sim =
      q.simAmount && q.simInstallments
        ? { amountCents: q.simAmount, installments: q.simInstallments, startMonth: q.simStart ?? currentMonth() }
        : null;
    // Simulação no passado não faz sentido: começa no mês atual no mínimo.
    if (sim && monthDiff(currentMonth(), sim.startMonth) < 0) sim.startMonth = currentMonth();
    return c.json(await plan.getProjection(c.env.DB, c.var.ctx, q.scope, q.months, sim));
  });

  // Metas
  r.get('/goals', async (c) => c.json(await goals.listGoals(c.env.DB, c.var.ctx)));
  r.post('/goals', async (c) => c.json(await goals.createGoal(c.env.DB, c.var.ctx, await parseJson(c.req.raw, goalSchema)), 201));
  r.patch('/goals/:id', async (c) => {
    await goals.updateGoal(c.env.DB, c.var.ctx, c.req.param('id'), await parseJson(c.req.raw, goalSchema.partial()));
    return c.json({ ok: true });
  });
  r.delete('/goals/:id', async (c) => {
    await goals.deleteGoal(c.env.DB, c.var.ctx, c.req.param('id'));
    return c.json({ ok: true });
  });
  r.post('/goals/:id/contributions', async (c) => {
    const b = await parseJson(c.req.raw, contributionSchema);
    const today = new Date().toISOString().slice(0, 10);
    return c.json(await goals.addContribution(c.env.DB, c.var.ctx, c.req.param('id'), b.amountCents, b.date ?? today), 201);
  });
  r.delete('/goals/:id/contributions/:cid', async (c) => {
    await goals.deleteContribution(c.env.DB, c.var.ctx, c.req.param('id'), c.req.param('cid'));
    return c.json({ ok: true });
  });
  r.post('/goals/:id/items', async (c) => {
    const b = await parseJson(c.req.raw, itemSchema);
    return c.json(await goals.addItem(c.env.DB, c.var.ctx, c.req.param('id'), b.name, b.amountCents), 201);
  });
  r.delete('/goals/:id/items/:iid', async (c) => {
    await goals.deleteItem(c.env.DB, c.var.ctx, c.req.param('id'), c.req.param('iid'));
    return c.json({ ok: true });
  });
}
