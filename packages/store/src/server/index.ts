import type { CoreEnv, ModuleHooks } from '@familia/core';
import { storeRoutes } from './routes';

export * as storeService from './service';
export type { BizCtx, StoreEnv } from './access';

const hooks: ModuleHooks = {
  id: 'store',
  /** Quem sai da família leva as empresas dela; e perde o acesso às empresas de outras pessoas da família. */
  async onMemberRemoved(env: CoreEnv, householdId, userId) {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM biz_businesses WHERE household_id = ? AND owner_user_id = ?`).bind(householdId, userId),
      env.DB.prepare(
        `DELETE FROM biz_members WHERE user_id = ? AND business_id IN (SELECT id FROM biz_businesses WHERE household_id = ?)`,
      ).bind(userId, householdId),
    ]);
  },
};

export const storeModule = {
  id: 'store',
  basePath: '/store',
  routes: storeRoutes,
  hooks,
  scheduled: undefined as ((env: CoreEnv) => Promise<void>) | undefined,
};
