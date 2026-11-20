// Tipos e contratos compartilhados entre o Worker e o React. Sem dependência de runtime.

export const ROLES = ['owner', 'admin', 'member'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABEL: Record<Role, string> = { owner: 'Dono(a)', admin: 'Administrador(a)', member: 'Membro' };
export const isManager = (role: Role) => role === 'owner' || role === 'admin';

export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'NO_HOUSEHOLD'
  | 'TWO_FACTOR_REQUIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'BAD_ORIGIN'
  | 'UPSTREAM'
  | 'INTERNAL';

export interface ApiErrorBody {
  error: string;
  code: ErrorCode;
}

/** Cabeçalho com a família ativa. O servidor sempre confere se o usuário é membro. */
export const HOUSEHOLD_HEADER = 'X-Household-Id';

export interface PublicConfig {
  appName: string;
  turnstileSiteKey: string | null;
  googleEnabled: boolean;
  openSignup: boolean;
}

export interface HouseholdSummary {
  id: string;
  name: string;
  role: Role;
}

export interface Me {
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
    emailVerified: boolean;
    twoFactorEnabled: boolean;
  };
  households: HouseholdSummary[];
  /** true quando o papel do usuário em alguma família exige 2FA e ele ainda não ativou. */
  twoFactorRequired: boolean;
  /** Como a segunda etapa é feita: app autenticador, código por e-mail ou ainda não ativada. */
  twoFactorMethod: 'totp' | 'email' | null;
}

export interface Member {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: Role;
  twoFactorEnabled: boolean;
  joinedAt: string;
}

export interface Invite {
  id: string;
  email: string;
  role: Exclude<Role, 'owner'>;
  invitedBy: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface AuditEntry {
  id: number;
  userId: string | null;
  userName: string | null;
  action: string;
  target: string | null;
  details: unknown;
  ip: string | null;
  createdAt: string;
}
