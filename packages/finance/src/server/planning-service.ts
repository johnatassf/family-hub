// Parcelas, faturas, rendas/fixos, projeção e sugestões. Recebe RequestCtx já autorizado.
import { type RequestCtx, fail, newId, nowIso } from '@familia/core';
import { isManager } from '@familia/shared';
import {
  type GoalLike,
  type InstallmentTx,
  type PlanEntryLike,
  type Simulation,
  addMonths,
  buildPurchases,
  currentMonth,
  detectRecurring,
  evaluateSimulation,
  installmentsByMonth,
  monthRange,
  occursIn,
  project,
} from '../planning';
import type { FinBill, InstallmentsResponse, PlanEntry, PlanScope, PlanSettings, ProjectionResponse, Visibility } from '../shared';
import { type TxFilters, txWhere, visibleAccounts } from './access';
import { applyReferenceMonths } from './adjust';

/**
 * Contas que entram no planejamento. Subconjunto da regra de visibilidade:
 * - família: só contas compartilhadas com a família;
 * - minhas: só as contas da própria pessoa.
 */
function planAccounts(ctx: RequestCtx, scope: PlanScope, alias = 'a') {
  return scope === 'family'
    ? { sql: `${alias}.household_id = ? AND ${alias}.visibility = 'family'`, params: [ctx.householdId] as string[] }
    : { sql: `${alias}.household_id = ? AND ${alias}.owner_user_id = ?`, params: [ctx.householdId, ctx.userId] as string[] };
}

// ---------- Parcelas ----------

async function loadInstallmentRows(db: D1Database, where: { sql: string; params: (string | number)[] }): Promise<InstallmentTx[]> {
  const { results } = await db
    .prepare(
      `SELECT t.id, t.account_id AS accountId, COALESCE(a.nickname, a.name, 'Conta') AS accountLabel, t.card_last4 AS cardLast4,
              a.owner_user_id AS ownerUserId, ou.name AS ownerName, COALESCE(au.name, ou.name) AS spenderName,
              t.description, t.amount_cents AS amountCents, t.reference_month AS referenceMonth, t.installment,
              t.purchase_date AS purchaseDate
         FROM fin_transactions t
         JOIN fin_accounts a ON a.id = t.account_id
         JOIN "user" ou ON ou.id = a.owner_user_id
         LEFT JOIN "user" au ON au.id = t.assigned_user_id
        WHERE ${where.sql} AND t.installment <> '' AND t.excluded = 0 AND t.amount_cents < 0`,
    )
    .bind(...where.params)
    .all<InstallmentTx>();
  return results;
}

export async function getInstallments(db: D1Database, ctx: RequestCtx, f: TxFilters, months = 12): Promise<InstallmentsResponse> {
  const current = currentMonth();
  const purchases = buildPurchases(await loadInstallmentRows(db, txWhere(ctx, { scope: f.scope, member: f.member, accountId: f.accountId })), current);
  const active = purchases.filter((p) => p.remainingCount > 0);
  const timeline = installmentsByMonth(active, monthRange(current, months));
  return {
    current,
    purchases: active,
    timeline,
    totals: {
      activePurchases: active.length,
      remainingCount: active.reduce((a, p) => a + p.remainingCount, 0),
      remainingCents: active.reduce((a, p) => a + p.remainingCents, 0),
      projectedCents: active.reduce((a, p) => a + p.installments.filter((i) => !i.real && i.month >= current).length * p.installmentCents, 0),
      thisMonthCents: (timeline[0]?.realCents ?? 0) + (timeline[0]?.projectedCents ?? 0),
    },
  };
}

// ---------- Faturas ----------

export async function listBills(db: D1Database, ctx: RequestCtx, accountId: string): Promise<FinBill[]> {
  const v = visibleAccounts(ctx);
  const ok = await db.prepare(`SELECT 1 FROM fin_accounts a WHERE a.id = ? AND ${v.sql}`).bind(accountId, ...v.params).first();
  if (!ok) fail(404, 'NOT_FOUND', 'Conta não encontrada.');
  const { results } = await db
    .prepare(
      `SELECT id, due_date AS dueDate, closing_date AS closingDate, total_cents AS totalCents, minimum_cents AS minimumCents
         FROM fin_bills WHERE account_id = ? ORDER BY due_date DESC LIMIT 12`,
    )
    .bind(accountId)
    .all<FinBill>();
  return results;
}

// ---------- Rendas e gastos fixos ----------

interface EntryRow {
  id: string;
  owner_user_id: string;
  owner_name: string;
  kind: 'income' | 'expense';
  name: string;
  amount_cents: number;
  frequency: PlanEntry['frequency'];
  month_of_year: number | null;
  start_month: string;
  end_month: string | null;
  visibility: Visibility;
}

const toEntry = (ctx: RequestCtx, r: EntryRow): PlanEntry => ({
  id: r.id,
  ownerUserId: r.owner_user_id,
  ownerName: r.owner_name,
  editable: r.owner_user_id === ctx.userId,
  kind: r.kind,
  name: r.name,
  amountCents: r.amount_cents,
  frequency: r.frequency,
  monthOfYear: r.month_of_year,
  startMonth: r.start_month,
  endMonth: r.end_month,
  visibility: r.visibility,
});

const toLike = (e: PlanEntry): PlanEntryLike => ({
  kind: e.kind,
  amountCents: e.amountCents,
  frequency: e.frequency,
  monthOfYear: e.monthOfYear,
  startMonth: e.startMonth,
  endMonth: e.endMonth,
});

const ENTRY_SELECT = `SELECT e.*, u.name AS owner_name FROM plan_entries e JOIN "user" u ON u.id = e.owner_user_id`;

/** As próprias (privadas ou não) + as que outras pessoas compartilharam com a família. */
export async function listEntries(db: D1Database, ctx: RequestCtx): Promise<PlanEntry[]> {
  const { results } = await db
    .prepare(`${ENTRY_SELECT} WHERE e.household_id = ? AND (e.owner_user_id = ? OR e.visibility = 'family') ORDER BY e.kind DESC, e.amount_cents DESC`)
    .bind(ctx.householdId, ctx.userId)
    .all<EntryRow>();
  return results.map((r) => toEntry(ctx, r));
}

async function entriesForScope(db: D1Database, ctx: RequestCtx, scope: PlanScope): Promise<PlanEntry[]> {
  const where = scope === 'family' ? `e.household_id = ? AND e.visibility = 'family'` : `e.household_id = ? AND e.owner_user_id = ?`;
  const params = scope === 'family' ? [ctx.householdId] : [ctx.householdId, ctx.userId];
  const { results } = await db.prepare(`${ENTRY_SELECT} WHERE ${where}`).bind(...params).all<EntryRow>();
  return results.map((r) => toEntry(ctx, r));
}

export interface EntryInput {
  kind: 'income' | 'expense';
  name: string;
  amountCents: number;
  frequency: PlanEntry['frequency'];
  monthOfYear?: number | null;
  startMonth: string;
  endMonth?: string | null;
  visibility: Visibility;
}

const checkEntry = (e: Partial<EntryInput>) => {
  if (e.endMonth && e.startMonth && e.endMonth < e.startMonth) fail(400, 'VALIDATION', 'O mês final é anterior ao inicial.');
};

export async function createEntry(db: D1Database, ctx: RequestCtx, input: EntryInput) {
  checkEntry(input);
  const id = newId();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO plan_entries (id, household_id, owner_user_id, kind, name, amount_cents, frequency, month_of_year, start_month, end_month, visibility, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id, ctx.householdId, ctx.userId, input.kind, input.name, input.amountCents, input.frequency,
      input.frequency === 'yearly' ? (input.monthOfYear ?? Number(input.startMonth.slice(5, 7))) : null,
      input.startMonth, input.frequency === 'once' ? null : (input.endMonth ?? null), input.visibility, now, now,
    )
    .run();
  return { id };
}

async function ownEntry(db: D1Database, ctx: RequestCtx, id: string) {
  const row = await db
    .prepare(`SELECT start_month, end_month FROM plan_entries WHERE id = ? AND household_id = ? AND owner_user_id = ?`)
    .bind(id, ctx.householdId, ctx.userId)
    .first<{ start_month: string; end_month: string | null }>();
  if (!row) fail(404, 'NOT_FOUND', 'Lançamento não encontrado.');
  return row!;
}

export async function updateEntry(db: D1Database, ctx: RequestCtx, id: string, patch: Partial<EntryInput>) {
  const row = await ownEntry(db, ctx, id);
  checkEntry({ startMonth: patch.startMonth ?? row.start_month, endMonth: patch.endMonth === undefined ? row.end_month : patch.endMonth });
  const cols: Record<string, string> = {
    kind: 'kind', name: 'name', amountCents: 'amount_cents', frequency: 'frequency', monthOfYear: 'month_of_year',
    startMonth: 'start_month', endMonth: 'end_month', visibility: 'visibility',
  };
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  for (const [k, col] of Object.entries(cols)) {
    const v = patch[k as keyof EntryInput];
    if (v !== undefined) {
      sets.push(`${col} = ?`);
      params.push(v as string | number | null);
    }
  }
  if (!sets.length) fail(400, 'VALIDATION', 'Nenhuma alteração.');
  await db.prepare(`UPDATE plan_entries SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).bind(...params, nowIso(), id).run();
}

export async function deleteEntry(db: D1Database, ctx: RequestCtx, id: string) {
  await ownEntry(db, ctx, id);
  await db.prepare(`DELETE FROM plan_entries WHERE id = ?`).bind(id).run();
}

// ---------- Configurações ----------

export async function getSettings(db: D1Database, householdId: string): Promise<PlanSettings> {
  const row = await db
    .prepare(`SELECT commit_limit_pct, variable_override_cents, card_month FROM plan_settings WHERE household_id = ?`)
    .bind(householdId)
    .first<{ commit_limit_pct: number; variable_override_cents: number | null; card_month: PlanSettings['cardMonth'] }>();
  return {
    commitLimitPct: row?.commit_limit_pct ?? 30,
    variableOverrideCents: row?.variable_override_cents ?? null,
    cardMonth: row?.card_month ?? 'bill',
  };
}

export async function updateSettings(db: D1Database, ctx: RequestCtx, patch: Partial<PlanSettings>) {
  if (!isManager(ctx.role)) fail(403, 'FORBIDDEN', 'Só dono(a) ou administrador(a) muda os parâmetros da família.');
  const cur = await getSettings(db, ctx.householdId);
  const next = { ...cur, ...patch };
  await db
    .prepare(
      `INSERT INTO plan_settings (household_id, commit_limit_pct, variable_override_cents, card_month, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(household_id) DO UPDATE SET commit_limit_pct = excluded.commit_limit_pct,
         variable_override_cents = excluded.variable_override_cents, card_month = excluded.card_month, updated_at = excluded.updated_at`,
    )
    .bind(ctx.householdId, next.commitLimitPct, next.variableOverrideCents, next.cardMonth, nowIso())
    .run();
  // Vale para a família toda: recalcula o mês de todos os lançamentos de cartão (menos os editados à mão).
  if (next.cardMonth !== cur.cardMonth) await applyReferenceMonths(db, ctx.householdId, next.cardMonth);
}

// ---------- Projeção ----------

/**
 * Gasto variável estimado: média dos últimos 3 meses fechados (sem parcelas e sem transferências excluídas),
 * menos os gastos fixos cadastrados (que já estão dentro dessa média, se forem pagos pelas contas).
 */
async function estimateVariable(db: D1Database, ctx: RequestCtx, scope: PlanScope, current: string, fixedMonthly: number) {
  const months = [-3, -2, -1].map((k) => addMonths(current, k));
  const acc = planAccounts(ctx, scope);
  const row = await db
    .prepare(
      `SELECT SUM(-t.amount_cents) AS total, COUNT(DISTINCT t.reference_month) AS n
         FROM fin_transactions t JOIN fin_accounts a ON a.id = t.account_id
        WHERE ${acc.sql} AND t.excluded = 0 AND t.amount_cents < 0 AND t.installment = '' AND t.reference_month IN (?, ?, ?)`,
    )
    .bind(...acc.params, ...months)
    .first<{ total: number | null; n: number }>();
  const avg = row?.total ? Math.round(row.total / Math.max(1, row.n)) : 0;
  return Math.max(0, avg - fixedMonthly);
}

async function goalsForScope(db: D1Database, ctx: RequestCtx, scope: PlanScope): Promise<GoalLike[]> {
  const where = scope === 'family' ? `g.household_id = ? AND g.visibility = 'family'` : `g.household_id = ? AND g.owner_user_id = ?`;
  const params = scope === 'family' ? [ctx.householdId] : [ctx.householdId, ctx.userId];
  const { results } = await db
    .prepare(
      `SELECT g.target_cents AS targetCents, g.target_month AS targetMonth,
              COALESCE((SELECT SUM(c.amount_cents) FROM goal_contributions c WHERE c.goal_id = g.id), 0) AS savedCents
         FROM goals g WHERE ${where} AND g.status = 'active'`,
    )
    .bind(...params)
    .all<GoalLike>();
  return results;
}

export async function getProjection(
  db: D1Database,
  ctx: RequestCtx,
  scope: PlanScope,
  monthsCount = 12,
  simulation: Simulation | null = null,
): Promise<ProjectionResponse> {
  const current = currentMonth();
  const months = monthRange(current, monthsCount);
  const [entries, settings, goals] = await Promise.all([
    entriesForScope(db, ctx, scope),
    getSettings(db, ctx.householdId),
    goalsForScope(db, ctx, scope),
  ]);
  const likes = entries.map(toLike);
  const fixedNow = likes.filter((e) => e.kind === 'expense' && occursIn(e, current)).reduce((a, e) => a + e.amountCents, 0);
  const acc = planAccounts(ctx, scope);
  const purchases = buildPurchases(await loadInstallmentRows(db, acc), current);

  const manual = scope === 'family' && settings.variableOverrideCents !== null;
  const variableCents = manual ? settings.variableOverrideCents! : await estimateVariable(db, ctx, scope, current, fixedNow);

  const balance = await db
    .prepare(`SELECT COALESCE(SUM(a.balance_cents), 0) AS cents FROM fin_accounts a WHERE ${acc.sql} AND a.type = 'BANK'`)
    .bind(...acc.params)
    .first<{ cents: number }>();

  const input = {
    months,
    current,
    entries: likes,
    purchases,
    variableCents,
    goals,
    startBalanceCents: balance?.cents ?? 0,
    commitLimitPct: settings.commitLimitPct,
    simulation,
  };
  return {
    scope,
    current,
    months: project(input),
    startBalanceCents: input.startBalanceCents,
    variableCents,
    variableSource: manual ? 'manual' : 'auto',
    commitLimitPct: settings.commitLimitPct,
    hasIncome: likes.some((e) => e.kind === 'income'),
    simulation: simulation ? { input: simulation, verdict: evaluateSimulation({ ...input, simulation }) } : null,
  };
}

// ---------- Sugestões (recorrências nas próprias contas) ----------

export async function getSuggestions(db: D1Database, ctx: RequestCtx) {
  const current = currentMonth();
  const months = [-4, -3, -2, -1].map((k) => addMonths(current, k));
  const acc = planAccounts(ctx, 'mine');
  const { results } = await db
    .prepare(
      `SELECT t.description, t.amount_cents AS amountCents, t.reference_month AS referenceMonth, t.date
         FROM fin_transactions t JOIN fin_accounts a ON a.id = t.account_id
        WHERE ${acc.sql} AND t.excluded = 0 AND t.installment = '' AND t.reference_month IN (?, ?, ?, ?)`,
    )
    .bind(...acc.params, ...months)
    .all<{ description: string; amountCents: number; referenceMonth: string; date: string }>();
  return detectRecurring(results, months);
}
