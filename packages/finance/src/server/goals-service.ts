// Metas (compras, viagens, reserva): privadas ou da família, com aportes e itens de orçamento.
import { type RequestCtx, fail, newId, nowIso } from '@familia/core';
import { currentMonth, monthlyNeed } from '../planning';
import type { Goal, GoalKind, Visibility } from '../shared';

/** Vê: as próprias + as compartilhadas com a família. */
const VISIBLE = `g.household_id = ? AND (g.owner_user_id = ? OR g.visibility = 'family')`;

interface GoalRow {
  id: string;
  owner_user_id: string;
  owner_name: string;
  kind: GoalKind;
  name: string;
  target_cents: number;
  target_month: string;
  visibility: Visibility;
  status: Goal['status'];
  notes: string | null;
  saved_cents: number;
}

export async function listGoals(db: D1Database, ctx: RequestCtx): Promise<Goal[]> {
  const p = [ctx.householdId, ctx.userId];
  const [goals, items, contributions] = await db.batch([
    db
      .prepare(
        `SELECT g.*, u.name AS owner_name,
                COALESCE((SELECT SUM(c.amount_cents) FROM goal_contributions c WHERE c.goal_id = g.id), 0) AS saved_cents
           FROM goals g JOIN "user" u ON u.id = g.owner_user_id
          WHERE ${VISIBLE} AND g.status <> 'archived' ORDER BY g.status, g.target_month`,
      )
      .bind(...p),
    db
      .prepare(`SELECT i.id, i.goal_id, i.name, i.amount_cents FROM goal_items i JOIN goals g ON g.id = i.goal_id WHERE ${VISIBLE} ORDER BY i.created_at`)
      .bind(...p),
    db
      .prepare(
        `SELECT c.id, c.goal_id, c.amount_cents, c.date, c.user_id, u.name AS user_name
           FROM goal_contributions c JOIN goals g ON g.id = c.goal_id LEFT JOIN "user" u ON u.id = c.user_id
          WHERE ${VISIBLE} ORDER BY c.date DESC, c.created_at DESC`,
      )
      .bind(...p),
  ]);
  const current = currentMonth();
  type ItemRow = { id: string; goal_id: string; name: string; amount_cents: number };
  type ContribRow = { id: string; goal_id: string; amount_cents: number; date: string; user_id: string | null; user_name: string | null };
  return (goals!.results as GoalRow[]).map((g) => ({
    id: g.id,
    ownerUserId: g.owner_user_id,
    ownerName: g.owner_name,
    editable: g.owner_user_id === ctx.userId,
    kind: g.kind,
    name: g.name,
    targetCents: g.target_cents,
    targetMonth: g.target_month,
    visibility: g.visibility,
    status: g.status,
    notes: g.notes,
    savedCents: g.saved_cents,
    monthlyNeedCents: g.status === 'active' ? monthlyNeed({ targetCents: g.target_cents, savedCents: g.saved_cents, targetMonth: g.target_month }, current) : 0,
    items: (items!.results as ItemRow[]).filter((i) => i.goal_id === g.id).map((i) => ({ id: i.id, name: i.name, amountCents: i.amount_cents })),
    contributions: (contributions!.results as ContribRow[])
      .filter((c) => c.goal_id === g.id)
      .map((c) => ({ id: c.id, amountCents: c.amount_cents, date: c.date, userName: c.user_name, mine: c.user_id === ctx.userId })),
  }));
}

/** Meta visível para a pessoa (própria ou da família). `own` exige ser o dono. */
async function findGoal(db: D1Database, ctx: RequestCtx, id: string, own: boolean) {
  const row = await db
    .prepare(`SELECT g.owner_user_id FROM goals g WHERE g.id = ? AND ${VISIBLE}`)
    .bind(id, ctx.householdId, ctx.userId)
    .first<{ owner_user_id: string }>();
  if (!row || (own && row.owner_user_id !== ctx.userId)) fail(404, 'NOT_FOUND', 'Meta não encontrada.');
  return row!;
}

export interface GoalInput {
  kind: GoalKind;
  name: string;
  targetCents: number;
  targetMonth: string;
  visibility: Visibility;
  status?: Goal['status'];
  notes?: string | null;
}

export async function createGoal(db: D1Database, ctx: RequestCtx, input: GoalInput) {
  const id = newId();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO goals (id, household_id, owner_user_id, kind, name, target_cents, target_month, visibility, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, ctx.householdId, ctx.userId, input.kind, input.name, input.targetCents, input.targetMonth, input.visibility, input.notes ?? null, now, now)
    .run();
  return { id };
}

export async function updateGoal(db: D1Database, ctx: RequestCtx, id: string, patch: Partial<GoalInput>) {
  await findGoal(db, ctx, id, true);
  const cols: Record<string, string> = {
    kind: 'kind', name: 'name', targetCents: 'target_cents', targetMonth: 'target_month', visibility: 'visibility', status: 'status', notes: 'notes',
  };
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  for (const [k, col] of Object.entries(cols)) {
    const v = patch[k as keyof GoalInput];
    if (v !== undefined) {
      sets.push(`${col} = ?`);
      params.push(v as string | number | null);
    }
  }
  if (!sets.length) fail(400, 'VALIDATION', 'Nenhuma alteração.');
  await db.prepare(`UPDATE goals SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).bind(...params, nowIso(), id).run();
}

export async function deleteGoal(db: D1Database, ctx: RequestCtx, id: string) {
  await findGoal(db, ctx, id, true);
  await db.prepare(`DELETE FROM goals WHERE id = ?`).bind(id).run();
}

/** Qualquer pessoa que vê a meta pode registrar quanto guardou (retirada = valor negativo). */
export async function addContribution(db: D1Database, ctx: RequestCtx, goalId: string, amountCents: number, date: string) {
  await findGoal(db, ctx, goalId, false);
  const id = newId();
  await db
    .prepare(`INSERT INTO goal_contributions (id, goal_id, user_id, amount_cents, date, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, goalId, ctx.userId, amountCents, date, nowIso())
    .run();
  return { id };
}

/** Apaga o próprio aporte; o dono da meta apaga qualquer aporte dela. */
export async function deleteContribution(db: D1Database, ctx: RequestCtx, goalId: string, contributionId: string) {
  const goal = await findGoal(db, ctx, goalId, false);
  const res = await db
    .prepare(`DELETE FROM goal_contributions WHERE id = ? AND goal_id = ? AND (user_id = ? OR ?)`)
    .bind(contributionId, goalId, ctx.userId, goal.owner_user_id === ctx.userId ? 1 : 0)
    .run();
  if (!res.meta.changes) fail(404, 'NOT_FOUND', 'Aporte não encontrado.');
}

export async function addItem(db: D1Database, ctx: RequestCtx, goalId: string, name: string, amountCents: number) {
  await findGoal(db, ctx, goalId, true);
  const id = newId();
  await db
    .prepare(`INSERT INTO goal_items (id, goal_id, name, amount_cents, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, goalId, name, amountCents, nowIso())
    .run();
  return { id };
}

export async function deleteItem(db: D1Database, ctx: RequestCtx, goalId: string, itemId: string) {
  await findGoal(db, ctx, goalId, true);
  const res = await db.prepare(`DELETE FROM goal_items WHERE id = ? AND goal_id = ?`).bind(itemId, goalId).run();
  if (!res.meta.changes) fail(404, 'NOT_FOUND', 'Item não encontrado.');
}
