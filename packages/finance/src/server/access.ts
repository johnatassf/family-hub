import type { RequestCtx } from '@familia/core';
import type { Scope } from '../shared';

/**
 * ÚNICA regra de visibilidade do módulo. Toda consulta de contas/transações passa por aqui:
 * a pessoa vê as próprias contas + as contas que outras pessoas da MESMA família compartilharam.
 * Nem o dono(a) da família vê conta privada de outra pessoa.
 *
 * `a` é o alias de fin_accounts na consulta.
 */
export function visibleAccounts(ctx: Pick<RequestCtx, 'userId' | 'householdId'>, alias = 'a') {
  return {
    sql: `${alias}.household_id = ? AND (${alias}.owner_user_id = ? OR ${alias}.visibility = 'family')`,
    params: [ctx.householdId, ctx.userId] as (string | number)[],
  };
}

export async function visibleAccountIds(db: D1Database, ctx: Pick<RequestCtx, 'userId' | 'householdId'>): Promise<string[]> {
  const v = visibleAccounts(ctx);
  const { results } = await db
    .prepare(`SELECT a.id FROM fin_accounts a WHERE ${v.sql}`)
    .bind(...v.params)
    .all<{ id: string }>();
  return results.map((r) => r.id);
}

export interface TxFilters {
  scope?: Scope;
  /** Gastos de uma pessoa (atribuídos a ela ou, sem atribuição, das contas dela). */
  member?: string;
  accountId?: string;
  month?: string;
  category?: string;
  review?: boolean;
}

/** Monta o WHERE de transações: visibilidade SEMPRE primeiro, filtros opcionais depois. */
export function txWhere(ctx: Pick<RequestCtx, 'userId' | 'householdId'>, f: TxFilters) {
  const v = visibleAccounts(ctx);
  const clauses = [v.sql];
  const params = [...v.params];
  if (f.scope === 'mine') {
    clauses.push('a.owner_user_id = ?');
    params.push(ctx.userId);
  } else if (f.scope === 'family') {
    clauses.push(`a.visibility = 'family'`);
  }
  if (f.member) {
    clauses.push('COALESCE(t.assigned_user_id, a.owner_user_id) = ?');
    params.push(f.member);
  }
  if (f.accountId) {
    clauses.push('t.account_id = ?');
    params.push(f.accountId);
  }
  if (f.month) {
    clauses.push('t.reference_month = ?');
    params.push(f.month);
  }
  if (f.category) {
    clauses.push('t.category = ?');
    params.push(f.category);
  }
  if (f.review) clauses.push(`(t.confidence = 'Baixa' OR t.category = 'Outros')`);
  return { sql: clauses.join(' AND '), params };
}
