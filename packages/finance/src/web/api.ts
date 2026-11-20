import { apiFetch } from '@familia/ui';
import type {
  FinAccount,
  FinBill,
  FinCategoriesResponse,
  FinItem,
  FinSummary,
  FinTransaction,
  Goal,
  GoalKind,
  InstallmentsResponse,
  PlanEntry,
  PlanSettings,
  ProjectionResponse,
  RecurringSuggestion,
  SyncResult,
  Visibility,
} from '../shared';

const base = '/api/finance';
const enc = encodeURIComponent;

export interface TxPatch {
  category?: string;
  referenceMonth?: string;
  excluded?: boolean;
  assignedUserId?: string | null;
}

export const financeApi = {
  summary: (q: string) => apiFetch<FinSummary>(`${base}/summary?${q}`),
  transactions: (q: string) => apiFetch<FinTransaction[]>(`${base}/transactions?${q}`),
  editTransaction: (id: string, patch: TxPatch) => apiFetch(`${base}/transactions/${enc(id)}`, { method: 'PATCH', body: patch }),
  accounts: () => apiFetch<FinAccount[]>(`${base}/accounts`),
  updateAccount: (id: string, patch: { visibility?: Visibility; nickname?: string | null }) =>
    apiFetch(`${base}/accounts/${enc(id)}`, { method: 'PATCH', body: patch }),
  members: () => apiFetch<{ userId: string; name: string }[]>(`${base}/members`),
  items: () => apiFetch<FinItem[]>(`${base}/items`),
  addItem: (pluggyItemId: string, ownerUserId?: string) => apiFetch<{ id: string }>(`${base}/items`, { method: 'POST', body: { pluggyItemId, ownerUserId } }),
  removeItem: (id: string, revoke: boolean) => apiFetch(`${base}/items/${enc(id)}${revoke ? '?revoke=1' : ''}`, { method: 'DELETE' }),
  syncItem: (id: string, full = false) => apiFetch<SyncResult>(`${base}/items/${enc(id)}/sync${full ? '?full=1' : ''}`, { method: 'POST' }),
  syncAll: () => apiFetch<SyncResult[]>(`${base}/sync`, { method: 'POST' }),
  categories: () => apiFetch<FinCategoriesResponse>(`${base}/categories`),
  addCategory: (name: string) => apiFetch(`${base}/categories`, { method: 'POST', body: { name } }),
  addRule: (pattern: string, category: string) => apiFetch(`${base}/rules`, { method: 'POST', body: { pattern, category } }),
  deleteRule: (id: number) => apiFetch(`${base}/rules/${id}`, { method: 'DELETE' }),
  installments: (q: string) => apiFetch<InstallmentsResponse>(`${base}/installments?${q}`),
  bills: (accountId: string) => apiFetch<FinBill[]>(`${base}/accounts/${enc(accountId)}/bills`),
  planEntries: () => apiFetch<PlanEntry[]>(`${base}/plan/entries`),
  createEntry: (e: EntryInput) => apiFetch<{ id: string }>(`${base}/plan/entries`, { method: 'POST', body: e }),
  updateEntry: (id: string, e: Partial<EntryInput>) => apiFetch(`${base}/plan/entries/${enc(id)}`, { method: 'PATCH', body: e }),
  deleteEntry: (id: string) => apiFetch(`${base}/plan/entries/${enc(id)}`, { method: 'DELETE' }),
  suggestions: () => apiFetch<RecurringSuggestion[]>(`${base}/plan/suggestions`),
  settings: () => apiFetch<PlanSettings>(`${base}/plan/settings`),
  updateSettings: (s: Partial<PlanSettings>) => apiFetch(`${base}/plan/settings`, { method: 'PATCH', body: s }),
  projection: (q: string) => apiFetch<ProjectionResponse>(`${base}/plan/projection?${q}`),
  goals: () => apiFetch<Goal[]>(`${base}/goals`),
  createGoal: (g: GoalInput) => apiFetch<{ id: string }>(`${base}/goals`, { method: 'POST', body: g }),
  updateGoal: (id: string, g: Partial<GoalInput> & { status?: Goal['status'] }) => apiFetch(`${base}/goals/${enc(id)}`, { method: 'PATCH', body: g }),
  deleteGoal: (id: string) => apiFetch(`${base}/goals/${enc(id)}`, { method: 'DELETE' }),
  addContribution: (id: string, amountCents: number) => apiFetch(`${base}/goals/${enc(id)}/contributions`, { method: 'POST', body: { amountCents } }),
  deleteContribution: (id: string, cid: string) => apiFetch(`${base}/goals/${enc(id)}/contributions/${enc(cid)}`, { method: 'DELETE' }),
  addGoalItem: (id: string, name: string, amountCents: number) => apiFetch(`${base}/goals/${enc(id)}/items`, { method: 'POST', body: { name, amountCents } }),
  deleteGoalItem: (id: string, iid: string) => apiFetch(`${base}/goals/${enc(id)}/items/${enc(iid)}`, { method: 'DELETE' }),
  /** Baixa o CSV via fetch (o cabeçalho da família ativa não vai num link comum). */
  async downloadCsv(q: string) {
    const csv = await apiFetch<string>(`${base}/export.csv?${q}`);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'transacoes.csv' });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};

export interface EntryInput {
  kind: 'income' | 'expense';
  name: string;
  amountCents: number;
  frequency: 'monthly' | 'yearly' | 'once';
  monthOfYear?: number | null;
  startMonth: string;
  endMonth?: string | null;
  visibility: Visibility;
}

export interface GoalInput {
  kind: GoalKind;
  name: string;
  targetCents: number;
  targetMonth: string;
  visibility: Visibility;
  notes?: string | null;
}
