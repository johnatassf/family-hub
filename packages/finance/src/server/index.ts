import type { CoreEnv, ModuleHooks } from '@familia/core';
import { type FinanceEnv, pluggyFromEnv } from './env';
import { financeRoutes } from './routes';
import { deleteAtPluggy } from './service';
import { syncDueItems } from './sync';

export type { FinanceEnv } from './env';
export { createPluggyClient, PluggyError, type PluggyClient } from './pluggy';
export { classify, installmentOf, norm, signedCents, toRow, DEFAULT_RULES } from './classify';
export { syncItem, syncDueItems, ensureFinanceDefaults } from './sync';
export { applyReferenceMonths, getCardMonth, reconcileBillPayments } from './adjust';
export { visibleAccounts, visibleAccountIds, txWhere } from './access';
export * as financeService from './service';
export * as planningService from './planning-service';
export * as goalsService from './goals-service';

async function revokeItems(env: FinanceEnv, where: string, params: string[]) {
  const { results } = await env.DB.prepare(`SELECT pluggy_item_id FROM fin_items WHERE ${where}`)
    .bind(...params)
    .all<{ pluggy_item_id: string }>();
  if (!results.length || !env.PLUGGY_CLIENT_ID) return;
  const pluggy = pluggyFromEnv(env);
  for (const r of results) {
    try {
      await deleteAtPluggy(pluggy, r.pluggy_item_id);
    } catch (e) {
      console.error('[finance] falha ao revogar item na Pluggy', e);
    }
  }
}

const hooks: ModuleHooks = {
  id: 'finance',
  /** Quem sai da família leva os dados junto: conexões revogadas e apagadas, atribuições limpas. */
  async onMemberRemoved(coreEnv: CoreEnv, householdId, userId) {
    const env = coreEnv as FinanceEnv;
    await revokeItems(env, 'household_id = ? AND owner_user_id = ?', [householdId, userId]);
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM fin_items WHERE household_id = ? AND owner_user_id = ?`).bind(householdId, userId),
      env.DB.prepare(`UPDATE fin_transactions SET assigned_user_id = NULL WHERE household_id = ? AND assigned_user_id = ?`).bind(
        householdId,
        userId,
      ),
      // Rendas, gastos fixos e metas da pessoa saem com ela (aportes e itens caem em cascata).
      env.DB.prepare(`DELETE FROM plan_entries WHERE household_id = ? AND owner_user_id = ?`).bind(householdId, userId),
      env.DB.prepare(`DELETE FROM goals WHERE household_id = ? AND owner_user_id = ?`).bind(householdId, userId),
    ]);
  },
  /** Exclusão de conta (LGPD): revoga as conexões na Pluggy; o D1 apaga o resto em cascata. */
  async onUserDeleted(coreEnv: CoreEnv, userId) {
    await revokeItems(coreEnv as FinanceEnv, 'owner_user_id = ?', [userId]);
  },
};

export const financeModule = {
  id: 'finance',
  basePath: '/finance',
  routes: financeRoutes,
  hooks,
  async scheduled(env: FinanceEnv) {
    if (!env.PLUGGY_CLIENT_ID || !env.PLUGGY_CLIENT_SECRET) return;
    const results = await syncDueItems(env.DB, pluggyFromEnv(env));
    if (results.length) console.log('[finance] cron', JSON.stringify(results));
  },
};
