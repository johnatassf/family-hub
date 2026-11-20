import { createContext, useContext } from 'react';
import type { HouseholdSummary, Me } from '@familia/shared';

export interface SessionValue {
  me: Me;
  household: HouseholdSummary;
}

export const SessionContext = createContext<SessionValue | null>(null);

/** Usuário logado + família ativa. Só existe dentro da área autenticada. */
export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession fora da área autenticada');
  return value;
}
