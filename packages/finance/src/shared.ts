// Contratos do módulo financeiro compartilhados entre Worker e React.
import type { Frequency, ProjectionMonth, Purchase, RecurringSuggestion, Simulation, SimulationVerdict } from './planning';

export const DEFAULT_CATEGORIES = [
  'Casa',
  'Mercado',
  'Alimentação',
  'Transporte',
  'Saúde/Farmácia',
  'Educação',
  'Assinaturas',
  'Compras pessoais',
  'Lazer',
  'Transferências',
  'Outros',
] as const;

export type Visibility = 'private' | 'family';
export type Scope = 'all' | 'mine' | 'family';
export type Confidence = 'Alta' | 'Baixa' | 'Manual';

export interface FinAccount {
  id: string;
  itemId: string;
  ownerUserId: string;
  ownerName: string;
  isMine: boolean;
  type: string | null;
  subtype: string | null;
  name: string | null;
  number: string | null;
  nickname: string | null;
  visibility: Visibility;
  connectorName: string | null;
  lastSyncAt: string | null;
  transactions: number;
  /** Conta: saldo. Cartão: valor em aberto. */
  balanceCents: number | null;
  creditLimitCents: number | null;
  availableLimitCents: number | null;
  dueDate: string | null;
  minimumPaymentCents: number | null;
}

export interface FinItem {
  id: string;
  /** Só aparece para o dono da conexão. */
  pluggyItemId: string | null;
  ownerUserId: string;
  ownerName: string;
  isMine: boolean;
  connectorName: string | null;
  status: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  accounts: number;
}

export interface FinTransaction {
  id: string;
  accountId: string;
  accountLabel: string;
  ownerUserId: string;
  ownerName: string;
  assignedUserId: string | null;
  /** Quem gastou: a pessoa atribuída ou, sem atribuição, o dono da conta. */
  spenderName: string;
  /** Só o dono da conta edita. */
  editable: boolean;
  description: string;
  amountCents: number;
  date: string;
  referenceMonth: string;
  accountType: string | null;
  category: string;
  installment: string;
  excluded: boolean;
  confidence: Confidence;
  status: string | null;
  cardLast4: string | null;
}

export interface FinSummary {
  months: { month: string; expensesCents: number; incomeCents: number; netCents: number }[];
  categories: { category: string; totalCents: number }[];
  byPerson: { userId: string; name: string; expensesCents: number }[];
  total: number;
  review: number;
}

export interface FinCategoriesResponse {
  categories: string[];
  rules: { id: number; pattern: string; category: string }[];
}

export interface SyncResult {
  itemId: string;
  processed: number;
  accounts: number;
  /** true quando alguma conta trouxe o histórico inteiro (primeira vez ou "Buscar tudo"). */
  full?: boolean;
  error?: string;
}

export const formatBRL = (cents: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);

// ---------- Planejamento ----------

export type PlanScope = 'family' | 'mine';

export interface FinBill {
  id: string;
  dueDate: string;
  closingDate: string | null;
  totalCents: number;
  minimumCents: number | null;
}

export interface InstallmentsResponse {
  current: string;
  purchases: Purchase[];
  timeline: { month: string; realCents: number; projectedCents: number }[];
  totals: {
    activePurchases: number;
    remainingCount: number;
    remainingCents: number;
    /** Parte do restante que é previsão do app (o banco ainda não lançou). */
    projectedCents: number;
    thisMonthCents: number;
  };
}

export interface PlanEntry {
  id: string;
  ownerUserId: string;
  ownerName: string;
  editable: boolean;
  kind: 'income' | 'expense';
  name: string;
  amountCents: number;
  frequency: Frequency;
  monthOfYear: number | null;
  startMonth: string;
  endMonth: string | null;
  visibility: Visibility;
}

export interface PlanSettings {
  commitLimitPct: number;
  variableOverrideCents: number | null;
}

export interface ProjectionResponse {
  scope: PlanScope;
  current: string;
  months: ProjectionMonth[];
  startBalanceCents: number;
  variableCents: number;
  variableSource: 'auto' | 'manual';
  commitLimitPct: number;
  hasIncome: boolean;
  simulation: { input: Simulation; verdict: SimulationVerdict } | null;
}

export type GoalKind = 'purchase' | 'trip' | 'reserve' | 'other';

export interface Goal {
  id: string;
  ownerUserId: string;
  ownerName: string;
  editable: boolean;
  kind: GoalKind;
  name: string;
  targetCents: number;
  targetMonth: string;
  visibility: Visibility;
  status: 'active' | 'done' | 'archived';
  notes: string | null;
  savedCents: number;
  monthlyNeedCents: number;
  items: { id: string; name: string; amountCents: number }[];
  contributions: { id: string; amountCents: number; date: string; userName: string | null; mine: boolean }[];
}

export type { Frequency, ProjectionMonth, Purchase, RecurringSuggestion, Simulation, SimulationVerdict };
