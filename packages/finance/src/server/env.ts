import { type CoreEnv, fail, flag } from '@familia/core';
import { type PluggyClient, createPluggyClient } from './pluggy';

export interface FinanceEnv extends CoreEnv {
  PLUGGY_CLIENT_ID?: string;
  PLUGGY_CLIENT_SECRET?: string;
  PLUGGY_API_URL?: string;
  /** "true": membros comuns também podem cadastrar conexões. Na fase interna, só dono/admin. */
  FINANCE_MEMBERS_CAN_CONNECT?: string;
}

export const membersCanConnect = (env: FinanceEnv) => flag(env.FINANCE_MEMBERS_CAN_CONNECT);

export function pluggyFromEnv(env: FinanceEnv): PluggyClient {
  if (!env.PLUGGY_CLIENT_ID || !env.PLUGGY_CLIENT_SECRET) {
    return fail(503, 'UPSTREAM', 'Integração Pluggy não configurada no servidor.');
  }
  return createPluggyClient({
    clientId: env.PLUGGY_CLIENT_ID,
    clientSecret: env.PLUGGY_CLIENT_SECRET,
    baseUrl: env.PLUGGY_API_URL,
    kv: env.KV,
  });
}
