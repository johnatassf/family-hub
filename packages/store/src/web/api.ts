import { apiFetch } from '@familia/ui';
import type { BizRole, Business, Customer, Payable, PaymentMethod, Product, ProductKind, Sale, SaleItemInput, StoreDashboard } from '../shared';

const enc = encodeURIComponent;

export interface ProductInput {
  kind: ProductKind;
  name: string;
  brand?: string | null;
  category?: string | null;
  costCents?: number | null;
  priceCents?: number | null;
  stockQty?: number | null;
  minStock?: number | null;
  active?: boolean;
  notes?: string | null;
}

export interface PayableInput {
  supplier: string;
  description?: string | null;
  dueDate: string;
  amountCents: number;
  status?: 'open' | 'paid';
  paidCents?: number | null;
  paidDate?: string | null;
  shared?: boolean;
  notes?: string | null;
}

export const listBusinesses = () => apiFetch<Business[]>('/api/store/businesses');
export const createBusiness = (name: string) => apiFetch<{ id: string }>('/api/store/businesses', { method: 'POST', body: { name } });

/** Cliente da API de uma empresa. */
export function storeApi(bid: string) {
  const b = `/api/store/b/${enc(bid)}`;
  return {
    dashboard: (month?: string) => apiFetch<StoreDashboard>(`${b}/dashboard${month ? `?month=${month}` : ''}`),
    products: () => apiFetch<Product[]>(`${b}/products`),
    createProduct: (p: ProductInput) => apiFetch<{ id: string }>(`${b}/products`, { method: 'POST', body: p }),
    updateProduct: (id: string, p: Partial<ProductInput>) => apiFetch(`${b}/products/${enc(id)}`, { method: 'PATCH', body: p }),
    setComponents: (id: string, components: { componentId: string; qty: number }[]) => apiFetch(`${b}/products/${enc(id)}/components`, { method: 'PUT', body: { components } }),
    moveStock: (id: string, body: { delta: number; reason: 'purchase' | 'adjust'; unitCostCents?: number | null }) =>
      apiFetch<{ stockQty: number; costCents: number | null }>(`${b}/products/${enc(id)}/stock`, { method: 'POST', body }),
    customers: () => apiFetch<Customer[]>(`${b}/customers`),
    createCustomer: (c: { name: string; phone?: string | null; birthday?: string | null; notes?: string | null }) => apiFetch<{ id: string }>(`${b}/customers`, { method: 'POST', body: c }),
    updateCustomer: (id: string, c: { name?: string; phone?: string | null; birthday?: string | null; notes?: string | null }) => apiFetch(`${b}/customers/${enc(id)}`, { method: 'PATCH', body: c }),
    sales: (q: { month?: string; status?: Sale['status']; customerId?: string } = {}) =>
      apiFetch<Sale[]>(`${b}/sales?${new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][])}`),
    createSale: (s: { date: string; customerId?: string | null; items: SaleItemInput[]; discountCents?: number; paymentMethod: PaymentMethod; dueDate?: string | null; notes?: string | null }) =>
      apiFetch<{ id: string; totalCents: number }>(`${b}/sales`, { method: 'POST', body: s }),
    addPayment: (id: string, p: { amountCents: number; method: Exclude<PaymentMethod, 'fiado'>; date?: string }) => apiFetch<{ balanceCents: number }>(`${b}/sales/${enc(id)}/payments`, { method: 'POST', body: p }),
    cancelSale: (id: string) => apiFetch(`${b}/sales/${enc(id)}/cancel`, { method: 'POST' }),
    payables: (status?: 'open' | 'paid') => apiFetch<Payable[]>(`${b}/payables${status ? `?status=${status}` : ''}`),
    createPayable: (p: PayableInput) => apiFetch<{ id: string }>(`${b}/payables`, { method: 'POST', body: p }),
    updatePayable: (id: string, p: Partial<PayableInput>) => apiFetch(`${b}/payables/${enc(id)}`, { method: 'PATCH', body: p }),
    deletePayable: (id: string) => apiFetch(`${b}/payables/${enc(id)}`, { method: 'DELETE' }),
    members: () => apiFetch<{ userId: string; name: string; email: string; role: BizRole }[]>(`${b}/members`),
    setMember: (userId: string, role: 'editor' | 'viewer') => apiFetch(`${b}/members/${enc(userId)}`, { method: 'PUT', body: { role } }),
    removeMember: (userId: string) => apiFetch(`${b}/members/${enc(userId)}`, { method: 'DELETE' }),
  };
}

export type StoreApi = ReturnType<typeof storeApi>;

/** Data de hoje em Brasília (AAAA-MM-DD). */
export const todayBR = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
export const addDays = (isoDay: string, days: number) => new Date(Date.parse(`${isoDay}T12:00:00Z`) + days * 86400_000).toISOString().slice(0, 10);
