// Contratos e regras puras da loja (usados pelo Worker e pelo React).

export const BRANDS = ['Natura', 'O Boticário', 'Avon', 'Jequiti', 'Eudora', 'Própria', 'Outra'] as const;
export const CATEGORIES = ['Perfumaria', 'Corpo e banho', 'Rosto', 'Cabelo', 'Maquiagem', 'Infantil', 'Kits e cestas', 'Embalagens e insumos', 'Outros'] as const;
export type ProductKind = 'product' | 'kit' | 'supply';
export const KIND_LABEL: Record<ProductKind, string> = { product: 'Produto', kit: 'Kit / cesta', supply: 'Insumo' };

export const PAYMENT_METHODS = ['dinheiro', 'pix', 'debito', 'credito', 'fiado', 'outro'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  debito: 'Débito',
  credito: 'Crédito',
  fiado: 'Fiado (a prazo)',
  outro: 'Outro',
};

export type BizRole = 'owner' | 'editor' | 'viewer';
export const BIZ_ROLE_LABEL: Record<BizRole, string> = { owner: 'Dona(o)', editor: 'Pode editar', viewer: 'Só visualiza' };

export interface Business {
  id: string;
  name: string;
  kind: string;
  role: BizRole;
}

export interface Product {
  id: string;
  kind: ProductKind;
  name: string;
  brand: string | null;
  category: string | null;
  sku: string | null;
  costCents: number | null;
  priceCents: number | null;
  stockQty: number | null;
  minStock: number | null;
  active: boolean;
  notes: string | null;
  /** Só kits: componentes e se o custo está completo. */
  components?: { componentId: string; name: string; qty: number; costCents: number | null; stockQty: number | null }[];
  /** Kits: quantos dá para montar com o estoque atual dos componentes controlados. */
  buildable?: number | null;
  soldLast30?: number;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  birthday: string | null;
  notes: string | null;
  balanceCents: number;
  totalSpentCents: number;
  lastPurchase: string | null;
  openSales: number;
}

export interface SaleItemInput {
  productId?: string | null;
  description?: string | null;
  qty: number;
  unitPriceCents: number;
}

export interface Sale {
  id: string;
  date: string;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  paymentMethod: PaymentMethod;
  status: 'paid' | 'open' | 'canceled';
  dueDate: string | null;
  notes: string | null;
  items: { id: string; productId: string | null; description: string; qty: number; unitPriceCents: number; unitCostCents: number | null; totalCents: number }[];
  payments: { id: string; date: string; amountCents: number; method: string }[];
}

export interface Payable {
  id: string;
  supplier: string;
  description: string | null;
  dueDate: string;
  amountCents: number;
  status: 'open' | 'paid';
  paidCents: number | null;
  paidDate: string | null;
  shared: boolean;
  notes: string | null;
}

export interface StoreDashboard {
  month: string;
  sales: { count: number; revenueCents: number; profitCents: number; costCoveragePct: number; ticketCents: number };
  byMethod: { method: PaymentMethod; totalCents: number }[];
  receivable: { totalCents: number; overdueCents: number; customers: number };
  payable: { openCents: number; next30Cents: number; overdueCents: number; sharedOpenCents: number };
  cashflow: { month: string; inCents: number; outCents: number }[];
  topProducts: { name: string; qty: number; revenueCents: number }[];
  lowStock: { id: string; name: string; stockQty: number; minStock: number }[];
  birthdays: { id: string; name: string; birthday: string; phone: string | null }[];
}

// ---------- Regras puras ----------

/** Custo do kit = soma do custo dos componentes × quantidade. null se algum componente não tem custo. */
export function kitCost(components: { qty: number; costCents: number | null }[]): number | null {
  let total = 0;
  for (const c of components) {
    if (c.costCents === null) return null;
    total += c.costCents * c.qty;
  }
  return total;
}

/** Quantos kits dá para montar com o estoque dos componentes que controlam estoque. */
export function buildableKits(components: { qty: number; stockQty: number | null }[]): number | null {
  const tracked = components.filter((c) => c.stockQty !== null);
  if (!tracked.length) return null;
  return Math.max(0, Math.min(...tracked.map((c) => Math.floor((c.stockQty ?? 0) / c.qty))));
}

/** Margem sobre o preço de venda, em %. */
export const marginPct = (costCents: number | null, priceCents: number | null) =>
  costCents === null || !priceCents ? null : Math.round(((priceCents - costCents) / priceCents) * 1000) / 10;

/** Preço sugerido a partir do custo e da margem desejada sobre o preço (ex.: 40%). */
export const suggestedPrice = (costCents: number, marginPctTarget: number) =>
  Math.ceil(costCents / (1 - Math.min(95, Math.max(0, marginPctTarget)) / 100) / 10) * 10;

const BRAND_KEYWORDS: [string, string[]][] = [
  ['O Boticário', ['boticario', 'egeo', 'botika', 'malbec', 'lily', 'floratta', 'quasar', 'zaad', 'nativa spa', 'cuide-se bem', 'match', 'make b', 'intense', 'coffee']],
  ['Natura', ['natura', 'luna', 'kaiak', 'ekos', 'humor', 'essencial', 'tododia', 'chronos', 'una ', 'mamae e bebe', 'andiroba', 'faces', 'lumina', 'homem']],
  ['Avon', ['avon', 'renew', 'far away', 'attraction', 'musk']],
  ['Jequiti', ['jequiti']],
  ['Eudora', ['eudora', 'siage']],
];

const fold = (s: string) => s.normalize('NFKD').replace(/\p{Mn}/gu, '').toLowerCase();

/** Marca provável pela descrição (palavras-chave de linhas conhecidas). */
export function inferBrand(description: string): string | null {
  const d = ` ${fold(description)} `;
  for (const [brand, keys] of BRAND_KEYWORDS) if (keys.some((k) => d.includes(k))) return brand;
  return null;
}

/** "2 Sabonetes sortidos" → { qty: 2, name: "Sabonetes sortidos" }. */
export function splitQty(text: string): { qty: number; name: string } {
  const m = /^\s*(\d{1,3})\s*(?:x|un|und|unid\.?)?\s+(.+)$/i.exec(text);
  return m ? { qty: Math.max(1, Number(m[1])), name: m[2]!.trim().replace(/[,;]\s*$/, '') } : { qty: 1, name: text.trim().replace(/[,;]\s*$/, '') };
}

export const formatBRL = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
