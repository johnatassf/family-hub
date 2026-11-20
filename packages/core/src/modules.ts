import type { CoreEnv } from './env';

/**
 * Ganchos que cada módulo registra para reagir a eventos do núcleo sem que o núcleo
 * conheça os módulos. Ex.: o financeiro apaga as conexões Pluggy de quem sai da família.
 */
export interface ModuleHooks {
  id: string;
  /** Pessoa saiu (ou foi removida) da família: apagar os dados dela nesse módulo. */
  onMemberRemoved?(env: CoreEnv, householdId: string, userId: string): Promise<void>;
  /** Conta de usuário será excluída (LGPD): revogar acessos externos. Os dados no D1 caem em cascata. */
  onUserDeleted?(env: CoreEnv, userId: string): Promise<void>;
}

const registry = new Map<string, ModuleHooks>();

export const registerModuleHooks = (hooks: ModuleHooks) => {
  registry.set(hooks.id, hooks);
};

export async function runMemberRemovedHooks(env: CoreEnv, householdId: string, userId: string) {
  for (const hooks of registry.values()) await hooks.onMemberRemoved?.(env, householdId, userId);
}

export async function runUserDeletedHooks(env: CoreEnv, userId: string) {
  for (const hooks of registry.values()) await hooks.onUserDeleted?.(env, userId);
}
