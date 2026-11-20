// Regras de negócio da loja. Toda função recebe um BizCtx já autorizado (membro da empresa).
import { type RequestCtx, audit, fail, isMember, newId, nowIso } from '@familia/core';
import { type ImportPlan, type RawWorkbook, mapSpreadsheet } from '../import';
import {
  type BizRole,
  type Business,
  type Customer,
  type Payable,
  type PaymentMethod,
  type Product,
  type ProductKind,
  type Sale,
  type SaleItemInput,
  type StoreDashboard,
  buildableKits,
  kitCost,
} from '../shared';
import { type BizCtx, canWrite, isBizOwner, todayBR } from './access';

const addMonthsYm = (ym: string, k: number) => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const t = y * 12 + m - 1 + k;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};

// ---------- Empresas e membros ----------

export async function listBusinesses(db: D1Database, ctx: RequestCtx): Promise<Business[]> {
  const { results } = await db
    .prepare(
      `SELECT b.id, b.name, b.kind, m.role FROM biz_businesses b JOIN biz_members m ON m.business_id = b.id
        WHERE b.household_id = ? AND m.user_id = ? ORDER BY b.created_at`,
    )
    .bind(ctx.householdId, ctx.userId)
    .all<Business>();
  return results;
}

export async function createBusiness(db: D1Database, ctx: RequestCtx, name: string) {
  const id = newId();
  const now = nowIso();
  await db.batch([
    db.prepare(`INSERT INTO biz_businesses (id, household_id, owner_user_id, name, kind, created_at) VALUES (?, ?, ?, ?, 'gift_shop', ?)`).bind(id, ctx.householdId, ctx.userId, name, now),
    db.prepare(`INSERT INTO biz_members (business_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)`).bind(id, ctx.userId, now),
  ]);
  await audit(db, { householdId: ctx.householdId, userId: ctx.userId, action: 'store.business_created', target: id, details: { name } });
  return { id };
}

export async function listMembers(db: D1Database, biz: BizCtx) {
  const { results } = await db
    .prepare(
      `SELECT m.user_id AS userId, u.name, u.email, m.role FROM biz_members m JOIN "user" u ON u.id = m.user_id
        WHERE m.business_id = ? ORDER BY m.created_at`,
    )
    .bind(biz.businessId)
    .all<{ userId: string; name: string; email: string; role: BizRole }>();
  return results;
}

/** A dona adiciona alguém da família (como quem ajuda na loja). */
export async function setMember(db: D1Database, biz: BizCtx, householdId: string, userId: string, role: Exclude<BizRole, 'owner'>) {
  isBizOwner(biz);
  if (userId === biz.userId) fail(400, 'VALIDATION', 'Você já é a dona(o) da empresa.');
  if (!(await isMember(db, householdId, userId))) fail(400, 'VALIDATION', 'Essa pessoa não faz parte da família.');
  await db
    .prepare(
      `INSERT INTO biz_members (business_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(business_id, user_id) DO UPDATE SET role = excluded.role`,
    )
    .bind(biz.businessId, userId, role, nowIso())
    .run();
}

export async function removeMember(db: D1Database, biz: BizCtx, userId: string) {
  isBizOwner(biz);
  const res = await db.prepare(`DELETE FROM biz_members WHERE business_id = ? AND user_id = ? AND role <> 'owner'`).bind(biz.businessId, userId).run();
  if (!res.meta.changes) fail(404, 'NOT_FOUND', 'Membro não encontrado.');
}

// ---------- Produtos, kits e estoque ----------

interface ProductRow {
  id: string;
  kind: ProductKind;
  name: string;
  brand: string | null;
  category: string | null;
  sku: string | null;
  cost_cents: number | null;
  price_cents: number | null;
  stock_qty: number | null;
  min_stock: number | null;
  active: number;
  notes: string | null;
  sold30: number | null;
}

const toProduct = (r: ProductRow): Product => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  brand: r.brand,
  category: r.category,
  sku: r.sku,
  costCents: r.cost_cents,
  priceCents: r.price_cents,
  stockQty: r.stock_qty,
  minStock: r.min_stock,
  active: Boolean(r.active),
  notes: r.notes,
  soldLast30: r.sold30 ?? 0,
});

export async function listProducts(db: D1Database, biz: BizCtx): Promise<Product[]> {
  const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const [products, comps] = await db.batch([
    db
      .prepare(
        `SELECT p.*, (SELECT SUM(i.qty) FROM biz_sale_items i JOIN biz_sales s ON s.id = i.sale_id
                       WHERE i.product_id = p.id AND s.status <> 'canceled' AND s.date >= ?) AS sold30
           FROM biz_products p WHERE p.business_id = ? ORDER BY p.active DESC, p.kind, p.name`,
      )
      .bind(since, biz.businessId),
    db
      .prepare(
        `SELECT k.kit_id, k.component_id, k.qty, c.name, c.cost_cents, c.stock_qty
           FROM biz_kit_items k JOIN biz_products c ON c.id = k.component_id JOIN biz_products kit ON kit.id = k.kit_id
          WHERE kit.business_id = ? ORDER BY c.name`,
      )
      .bind(biz.businessId),
  ]);
  type CompRow = { kit_id: string; component_id: string; qty: number; name: string; cost_cents: number | null; stock_qty: number | null };
  const byKit = new Map<string, CompRow[]>();
  for (const c of comps!.results as CompRow[]) byKit.set(c.kit_id, [...(byKit.get(c.kit_id) ?? []), c]);
  return (products!.results as ProductRow[]).map((r) => {
    const p = toProduct(r);
    if (p.kind !== 'kit') return p;
    const components = (byKit.get(p.id) ?? []).map((c) => ({ componentId: c.component_id, name: c.name, qty: c.qty, costCents: c.cost_cents, stockQty: c.stock_qty }));
    return { ...p, components, costCents: components.length ? kitCost(components) : null, buildable: buildableKits(components) };
  });
}

export interface ProductInput {
  kind: ProductKind;
  name: string;
  brand?: string | null;
  category?: string | null;
  sku?: string | null;
  costCents?: number | null;
  priceCents?: number | null;
  stockQty?: number | null;
  minStock?: number | null;
  active?: boolean;
  notes?: string | null;
}

export async function createProduct(db: D1Database, biz: BizCtx, p: ProductInput) {
  canWrite(biz);
  const id = newId();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO biz_products (id, business_id, kind, name, brand, category, sku, cost_cents, price_cents, stock_qty, min_stock, active, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    )
    .bind(
      id, biz.businessId, p.kind, p.name, p.brand ?? null, p.category ?? null, p.sku ?? null,
      p.kind === 'kit' ? null : (p.costCents ?? null), p.priceCents ?? null,
      p.kind === 'kit' ? null : (p.stockQty ?? null), p.kind === 'kit' ? null : (p.minStock ?? null), p.notes ?? null, now, now,
    )
    .run();
  if (p.kind !== 'kit' && p.stockQty) {
    await db.prepare(`INSERT INTO biz_stock_moves (id, business_id, product_id, qty_delta, reason, created_at) VALUES (?, ?, ?, ?, 'adjust', ?)`).bind(newId(), biz.businessId, id, p.stockQty, now).run();
  }
  return { id };
}

async function ownProduct(db: D1Database, biz: BizCtx, id: string) {
  const row = await db.prepare(`SELECT kind, stock_qty, cost_cents FROM biz_products WHERE id = ? AND business_id = ?`).bind(id, biz.businessId).first<{ kind: ProductKind; stock_qty: number | null; cost_cents: number | null }>();
  if (!row) fail(404, 'NOT_FOUND', 'Produto não encontrado.');
  return row!;
}

export async function updateProduct(db: D1Database, biz: BizCtx, id: string, p: Partial<ProductInput>) {
  canWrite(biz);
  const cur = await ownProduct(db, biz, id);
  const cols: Record<string, string> = {
    name: 'name', brand: 'brand', category: 'category', sku: 'sku', costCents: 'cost_cents', priceCents: 'price_cents', minStock: 'min_stock', notes: 'notes',
  };
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  for (const [k, c] of Object.entries(cols)) {
    const v = p[k as keyof ProductInput];
    if (v === undefined || (cur.kind === 'kit' && (k === 'costCents' || k === 'minStock'))) continue;
    sets.push(`${c} = ?`);
    params.push(v as string | number | null);
  }
  if (p.active !== undefined) {
    sets.push('active = ?');
    params.push(p.active ? 1 : 0);
  }
  if (!sets.length) fail(400, 'VALIDATION', 'Nenhuma alteração.');
  await db.prepare(`UPDATE biz_products SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).bind(...params, nowIso(), id).run();
}

/** Componentes do kit (produtos ou insumos, nunca outro kit). */
export async function setKitComponents(db: D1Database, biz: BizCtx, kitId: string, components: { componentId: string; qty: number }[]) {
  canWrite(biz);
  const kit = await ownProduct(db, biz, kitId);
  if (kit.kind !== 'kit') fail(400, 'VALIDATION', 'Só kits têm componentes.');
  const ids = [...new Set(components.map((c) => c.componentId))];
  if (ids.length !== components.length) fail(400, 'VALIDATION', 'Componente repetido.');
  if (ids.includes(kitId)) fail(400, 'VALIDATION', 'Um kit não pode conter ele mesmo.');
  if (ids.length) {
    const { results } = await db
      .prepare(`SELECT id, kind FROM biz_products WHERE business_id = ? AND id IN (${ids.map(() => '?').join(',')})`)
      .bind(biz.businessId, ...ids)
      .all<{ id: string; kind: ProductKind }>();
    if (results.length !== ids.length) fail(400, 'VALIDATION', 'Componente não encontrado.');
    if (results.some((r) => r.kind === 'kit')) fail(400, 'VALIDATION', 'Um kit não pode conter outro kit.');
  }
  await db.batch([
    db.prepare(`DELETE FROM biz_kit_items WHERE kit_id = ?`).bind(kitId),
    ...components.map((c) => db.prepare(`INSERT INTO biz_kit_items (kit_id, component_id, qty) VALUES (?, ?, ?)`).bind(kitId, c.componentId, c.qty)),
    db.prepare(`UPDATE biz_products SET updated_at = ? WHERE id = ?`).bind(nowIso(), kitId),
  ]);
}

/**
 * Entrada de mercadoria ou ajuste de estoque. Na entrada com custo, o custo vira a média ponderada.
 * Produto sem controle de estoque passa a controlar a partir desta contagem.
 */
export async function moveStock(db: D1Database, biz: BizCtx, id: string, input: { delta: number; reason: 'purchase' | 'adjust'; unitCostCents?: number | null }) {
  canWrite(biz);
  const p = await ownProduct(db, biz, id);
  if (p.kind === 'kit') fail(400, 'VALIDATION', 'Kits não têm estoque próprio: o estoque é o dos componentes.');
  const oldQty = p.stock_qty ?? 0;
  const newQty = oldQty + input.delta;
  let cost = p.cost_cents;
  if (input.reason === 'purchase' && input.unitCostCents != null && input.delta > 0) {
    cost = oldQty > 0 && p.cost_cents !== null ? Math.round((p.cost_cents * oldQty + input.unitCostCents * input.delta) / newQty) : input.unitCostCents;
  }
  const now = nowIso();
  await db.batch([
    db.prepare(`UPDATE biz_products SET stock_qty = ?, cost_cents = ?, updated_at = ? WHERE id = ?`).bind(newQty, cost, now, id),
    db.prepare(`INSERT INTO biz_stock_moves (id, business_id, product_id, qty_delta, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)`).bind(newId(), biz.businessId, id, input.delta, input.reason, now),
  ]);
  return { stockQty: newQty, costCents: cost };
}

// ---------- Clientes ----------

export async function listCustomers(db: D1Database, biz: BizCtx): Promise<Customer[]> {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.name, c.phone, c.birthday, c.notes,
              COALESCE(SUM(CASE WHEN s.status = 'open' THEN s.total_cents - COALESCE(p.paid, 0) END), 0) AS balanceCents,
              COALESCE(SUM(CASE WHEN s.status <> 'canceled' THEN s.total_cents END), 0) AS totalSpentCents,
              MAX(CASE WHEN s.status <> 'canceled' THEN s.date END) AS lastPurchase,
              COUNT(CASE WHEN s.status = 'open' THEN 1 END) AS openSales
         FROM biz_customers c
         LEFT JOIN biz_sales s ON s.customer_id = c.id
         LEFT JOIN (SELECT sale_id, SUM(amount_cents) AS paid FROM biz_payments GROUP BY sale_id) p ON p.sale_id = s.id
        WHERE c.business_id = ? GROUP BY c.id ORDER BY c.name COLLATE NOCASE`,
    )
    .bind(biz.businessId)
    .all<Customer>();
  return results;
}

export interface CustomerInput {
  name: string;
  phone?: string | null;
  birthday?: string | null;
  notes?: string | null;
}

export async function createCustomer(db: D1Database, biz: BizCtx, c: CustomerInput) {
  canWrite(biz);
  const id = newId();
  const now = nowIso();
  await db
    .prepare(`INSERT INTO biz_customers (id, business_id, name, phone, birthday, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, biz.businessId, c.name, c.phone ?? null, c.birthday ?? null, c.notes ?? null, now, now)
    .run();
  return { id };
}

export async function updateCustomer(db: D1Database, biz: BizCtx, id: string, c: Partial<CustomerInput>) {
  canWrite(biz);
  const sets: string[] = [];
  const params: (string | null)[] = [];
  for (const k of ['name', 'phone', 'birthday', 'notes'] as const) {
    if (c[k] !== undefined) {
      sets.push(`${k} = ?`);
      params.push(c[k] ?? null);
    }
  }
  if (!sets.length) fail(400, 'VALIDATION', 'Nenhuma alteração.');
  const res = await db.prepare(`UPDATE biz_customers SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND business_id = ?`).bind(...params, nowIso(), id, biz.businessId).run();
  if (!res.meta.changes) fail(404, 'NOT_FOUND', 'Cliente não encontrado.');
}

// ---------- Vendas ----------

export interface SaleInput {
  date: string;
  customerId?: string | null;
  items: SaleItemInput[];
  discountCents?: number;
  paymentMethod: PaymentMethod;
  dueDate?: string | null;
  notes?: string | null;
}

/**
 * Registra a venda numa única transação (D1 batch): itens com custo do momento, baixa de estoque
 * (kit baixa os componentes), e o pagamento — exceto no fiado, que fica em aberto até a data combinada.
 */
export async function createSale(db: D1Database, biz: BizCtx, input: SaleInput) {
  canWrite(biz);
  if (!input.items.length) fail(400, 'VALIDATION', 'Adicione pelo menos um item.');
  if (input.paymentMethod === 'fiado' && !input.customerId) fail(400, 'VALIDATION', 'Venda fiado precisa de cliente.');
  if (input.customerId) {
    const ok = await db.prepare(`SELECT 1 FROM biz_customers WHERE id = ? AND business_id = ?`).bind(input.customerId, biz.businessId).first();
    if (!ok) fail(400, 'VALIDATION', 'Cliente não encontrado.');
  }

  const productIds = [...new Set(input.items.map((i) => i.productId).filter((x): x is string => Boolean(x)))];
  const products = new Map<string, { kind: ProductKind; name: string; cost_cents: number | null; stock_qty: number | null }>();
  const kitComponents = new Map<string, { component_id: string; qty: number; cost_cents: number | null; stock_qty: number | null }[]>();
  if (productIds.length) {
    const marks = productIds.map(() => '?').join(',');
    const [prods, comps] = await db.batch([
      db.prepare(`SELECT id, kind, name, cost_cents, stock_qty FROM biz_products WHERE business_id = ? AND id IN (${marks})`).bind(biz.businessId, ...productIds),
      db
        .prepare(`SELECT k.kit_id, k.component_id, k.qty, c.cost_cents, c.stock_qty FROM biz_kit_items k JOIN biz_products c ON c.id = k.component_id WHERE k.kit_id IN (${marks})`)
        .bind(...productIds),
    ]);
    for (const p of prods!.results as { id: string; kind: ProductKind; name: string; cost_cents: number | null; stock_qty: number | null }[]) products.set(p.id, p);
    for (const c of comps!.results as { kit_id: string; component_id: string; qty: number; cost_cents: number | null; stock_qty: number | null }[]) {
      kitComponents.set(c.kit_id, [...(kitComponents.get(c.kit_id) ?? []), c]);
    }
    if (products.size !== productIds.length) fail(400, 'VALIDATION', 'Produto não encontrado.');
  }

  const saleId = newId();
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [];
  const stockDelta = new Map<string, number>();
  let subtotal = 0;
  const items = input.items.map((i) => {
    const p = i.productId ? products.get(i.productId)! : null;
    if (!p && !i.description?.trim()) fail(400, 'VALIDATION', 'Item sem produto precisa de descrição.');
    let unitCost: number | null = p?.cost_cents ?? null;
    if (p?.kind === 'kit') {
      const comps = kitComponents.get(i.productId!) ?? [];
      unitCost = comps.length ? kitCost(comps.map((c) => ({ qty: c.qty, costCents: c.cost_cents }))) : null;
      for (const c of comps) if (c.stock_qty !== null) stockDelta.set(c.component_id, (stockDelta.get(c.component_id) ?? 0) - c.qty * i.qty);
    } else if (p && p.stock_qty !== null) {
      stockDelta.set(i.productId!, (stockDelta.get(i.productId!) ?? 0) - i.qty);
    }
    const total = i.qty * i.unitPriceCents;
    subtotal += total;
    return { id: newId(), productId: i.productId ?? null, description: p?.name ?? i.description!.trim(), qty: i.qty, unitPrice: i.unitPriceCents, unitCost, total };
  });
  const discount = input.discountCents ?? 0;
  if (discount > subtotal) fail(400, 'VALIDATION', 'Desconto maior que o total.');
  const total = subtotal - discount;
  const isFiado = input.paymentMethod === 'fiado';

  stmts.push(
    db
      .prepare(
        `INSERT INTO biz_sales (id, business_id, customer_id, date, subtotal_cents, discount_cents, total_cents, payment_method, status, due_date, notes, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(saleId, biz.businessId, input.customerId ?? null, input.date, subtotal, discount, total, input.paymentMethod, isFiado && total > 0 ? 'open' : 'paid', isFiado ? (input.dueDate ?? null) : null, input.notes ?? null, biz.userId, now, now),
  );
  for (const it of items) {
    stmts.push(
      db
        .prepare(`INSERT INTO biz_sale_items (id, sale_id, product_id, description, qty, unit_price_cents, unit_cost_cents, total_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(it.id, saleId, it.productId, it.description, it.qty, it.unitPrice, it.unitCost, it.total),
    );
  }
  for (const [pid, delta] of stockDelta) {
    stmts.push(db.prepare(`UPDATE biz_products SET stock_qty = stock_qty + ?, updated_at = ? WHERE id = ? AND stock_qty IS NOT NULL`).bind(delta, now, pid));
    stmts.push(db.prepare(`INSERT INTO biz_stock_moves (id, business_id, product_id, qty_delta, reason, ref_id, created_at) VALUES (?, ?, ?, ?, 'sale', ?, ?)`).bind(newId(), biz.businessId, pid, delta, saleId, now));
  }
  if (!isFiado && total > 0) {
    stmts.push(db.prepare(`INSERT INTO biz_payments (id, sale_id, date, amount_cents, method, created_at) VALUES (?, ?, ?, ?, ?, ?)`).bind(newId(), saleId, input.date, total, input.paymentMethod, now));
  }
  await db.batch(stmts);
  return { id: saleId, totalCents: total };
}

const SALE_SELECT = `
SELECT s.*, c.name AS customer_name, c.phone AS customer_phone,
       COALESCE((SELECT SUM(amount_cents) FROM biz_payments p WHERE p.sale_id = s.id), 0) AS paid_cents
  FROM biz_sales s LEFT JOIN biz_customers c ON c.id = s.customer_id`;

interface SaleRow {
  id: string;
  date: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  paid_cents: number;
  payment_method: PaymentMethod;
  status: Sale['status'];
  due_date: string | null;
  notes: string | null;
}

export async function listSales(db: D1Database, biz: BizCtx, f: { month?: string; status?: Sale['status']; customerId?: string; limit?: number }): Promise<Sale[]> {
  const where = ['s.business_id = ?'];
  const params: (string | number)[] = [biz.businessId];
  if (f.month) {
    where.push(`substr(s.date, 1, 7) = ?`);
    params.push(f.month);
  }
  if (f.status) {
    where.push('s.status = ?');
    params.push(f.status);
  }
  if (f.customerId) {
    where.push('s.customer_id = ?');
    params.push(f.customerId);
  }
  const order = f.status === 'open' ? 'COALESCE(s.due_date, s.date) ASC' : 's.date DESC, s.created_at DESC';
  const [sales, items, payments] = await db.batch([
    db.prepare(`${SALE_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`).bind(...params, f.limit ?? 500),
    db
      .prepare(`SELECT i.* FROM biz_sale_items i JOIN biz_sales s ON s.id = i.sale_id WHERE ${where.join(' AND ')}`)
      .bind(...params),
    db
      .prepare(`SELECT p.* FROM biz_payments p JOIN biz_sales s ON s.id = p.sale_id WHERE ${where.join(' AND ')} ORDER BY p.date`)
      .bind(...params),
  ]);
  type ItemRow = { id: string; sale_id: string; product_id: string | null; description: string; qty: number; unit_price_cents: number; unit_cost_cents: number | null; total_cents: number };
  type PayRow = { id: string; sale_id: string; date: string; amount_cents: number; method: string };
  const itemsBy = new Map<string, ItemRow[]>();
  for (const i of items!.results as ItemRow[]) itemsBy.set(i.sale_id, [...(itemsBy.get(i.sale_id) ?? []), i]);
  const paysBy = new Map<string, PayRow[]>();
  for (const p of payments!.results as PayRow[]) paysBy.set(p.sale_id, [...(paysBy.get(p.sale_id) ?? []), p]);
  return (sales!.results as SaleRow[]).map((s) => ({
    id: s.id,
    date: s.date,
    customerId: s.customer_id,
    customerName: s.customer_name,
    customerPhone: s.customer_phone,
    subtotalCents: s.subtotal_cents,
    discountCents: s.discount_cents,
    totalCents: s.total_cents,
    paidCents: s.paid_cents,
    balanceCents: s.status === 'canceled' ? 0 : Math.max(0, s.total_cents - s.paid_cents),
    paymentMethod: s.payment_method,
    status: s.status,
    dueDate: s.due_date,
    notes: s.notes,
    items: (itemsBy.get(s.id) ?? []).map((i) => ({ id: i.id, productId: i.product_id, description: i.description, qty: i.qty, unitPriceCents: i.unit_price_cents, unitCostCents: i.unit_cost_cents, totalCents: i.total_cents })),
    payments: (paysBy.get(s.id) ?? []).map((p) => ({ id: p.id, date: p.date, amountCents: p.amount_cents, method: p.method })),
  }));
}

async function ownSale(db: D1Database, biz: BizCtx, id: string) {
  const s = await db.prepare(`${SALE_SELECT} WHERE s.id = ? AND s.business_id = ?`).bind(id, biz.businessId).first<SaleRow>();
  if (!s) fail(404, 'NOT_FOUND', 'Venda não encontrada.');
  return s!;
}

/** Recebimento (fiado pago aos poucos). Quita a venda quando o saldo zera. */
export async function addPayment(db: D1Database, biz: BizCtx, saleId: string, p: { amountCents: number; date: string; method: string }) {
  canWrite(biz);
  const s = await ownSale(db, biz, saleId);
  if (s.status === 'canceled') fail(409, 'CONFLICT', 'Venda cancelada.');
  const balance = s.total_cents - s.paid_cents;
  if (balance <= 0) fail(409, 'CONFLICT', 'Essa venda já está quitada.');
  if (p.amountCents > balance) fail(400, 'VALIDATION', `O valor é maior que o saldo devedor (${(balance / 100).toFixed(2).replace('.', ',')}).`);
  const now = nowIso();
  await db.batch([
    db.prepare(`INSERT INTO biz_payments (id, sale_id, date, amount_cents, method, created_at) VALUES (?, ?, ?, ?, ?, ?)`).bind(newId(), saleId, p.date, p.amountCents, p.method, now),
    db.prepare(`UPDATE biz_sales SET status = ?, updated_at = ? WHERE id = ?`).bind(p.amountCents >= balance ? 'paid' : 'open', now, saleId),
  ]);
  return { balanceCents: balance - p.amountCents };
}

/** Cancela a venda e devolve ao estoque o que ela baixou. */
export async function cancelSale(db: D1Database, biz: BizCtx, saleId: string) {
  canWrite(biz);
  const s = await ownSale(db, biz, saleId);
  if (s.status === 'canceled') fail(409, 'CONFLICT', 'Venda já cancelada.');
  const { results: moves } = await db
    .prepare(`SELECT product_id, qty_delta FROM biz_stock_moves WHERE ref_id = ? AND reason = 'sale' AND business_id = ?`)
    .bind(saleId, biz.businessId)
    .all<{ product_id: string; qty_delta: number }>();
  const now = nowIso();
  await db.batch([
    db.prepare(`UPDATE biz_sales SET status = 'canceled', updated_at = ? WHERE id = ?`).bind(now, saleId),
    ...moves.flatMap((m) => [
      db.prepare(`UPDATE biz_products SET stock_qty = stock_qty - ?, updated_at = ? WHERE id = ? AND stock_qty IS NOT NULL`).bind(m.qty_delta, now, m.product_id),
      db.prepare(`INSERT INTO biz_stock_moves (id, business_id, product_id, qty_delta, reason, ref_id, created_at) VALUES (?, ?, ?, ?, 'cancel', ?, ?)`).bind(newId(), biz.businessId, m.product_id, -m.qty_delta, saleId, now),
    ]),
  ]);
}

// ---------- Contas a pagar (boletos) ----------

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

export async function listPayables(db: D1Database, biz: BizCtx, status?: 'open' | 'paid'): Promise<Payable[]> {
  const { results } = await db
    .prepare(
      `SELECT id, supplier, description, due_date AS dueDate, amount_cents AS amountCents, status, paid_cents AS paidCents,
              paid_date AS paidDate, shared, notes
         FROM biz_payables WHERE business_id = ? ${status ? 'AND status = ?' : ''}
        ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, ${status === 'paid' ? 'due_date DESC' : 'due_date ASC'}`,
    )
    .bind(...(status ? [biz.businessId, status] : [biz.businessId]))
    .all<Omit<Payable, 'shared'> & { shared: number }>();
  return results.map((r) => ({ ...r, shared: Boolean(r.shared) }));
}

export async function createPayable(db: D1Database, biz: BizCtx, p: PayableInput) {
  canWrite(biz);
  const id = newId();
  const now = nowIso();
  const paid = p.status === 'paid';
  await db
    .prepare(
      `INSERT INTO biz_payables (id, business_id, supplier, description, due_date, amount_cents, status, paid_cents, paid_date, shared, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, biz.businessId, p.supplier, p.description ?? null, p.dueDate, p.amountCents, paid ? 'paid' : 'open', paid ? (p.paidCents ?? p.amountCents) : null, paid ? (p.paidDate ?? todayBR()) : null, p.shared ? 1 : 0, p.notes ?? null, now, now)
    .run();
  return { id };
}

export async function updatePayable(db: D1Database, biz: BizCtx, id: string, p: Partial<PayableInput>) {
  canWrite(biz);
  const cur = await db.prepare(`SELECT amount_cents, status FROM biz_payables WHERE id = ? AND business_id = ?`).bind(id, biz.businessId).first<{ amount_cents: number; status: string }>();
  if (!cur) fail(404, 'NOT_FOUND', 'Conta não encontrada.');
  const next = { ...p };
  // Marcar como pago sem informar valor/data: considera o valor cheio, hoje.
  if (p.status === 'paid' && cur!.status !== 'paid') {
    next.paidCents ??= p.amountCents ?? cur!.amount_cents;
    next.paidDate ??= todayBR();
  }
  if (p.status === 'open') {
    next.paidCents = null;
    next.paidDate = null;
  }
  const cols: Record<string, string> = {
    supplier: 'supplier', description: 'description', dueDate: 'due_date', amountCents: 'amount_cents', status: 'status',
    paidCents: 'paid_cents', paidDate: 'paid_date', notes: 'notes',
  };
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  for (const [k, c] of Object.entries(cols)) {
    const v = next[k as keyof PayableInput];
    if (v !== undefined) {
      sets.push(`${c} = ?`);
      params.push(v as string | number | null);
    }
  }
  if (next.shared !== undefined) {
    sets.push('shared = ?');
    params.push(next.shared ? 1 : 0);
  }
  if (!sets.length) fail(400, 'VALIDATION', 'Nenhuma alteração.');
  await db.prepare(`UPDATE biz_payables SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).bind(...params, nowIso(), id).run();
}

export async function deletePayable(db: D1Database, biz: BizCtx, id: string) {
  canWrite(biz);
  const res = await db.prepare(`DELETE FROM biz_payables WHERE id = ? AND business_id = ?`).bind(id, biz.businessId).run();
  if (!res.meta.changes) fail(404, 'NOT_FOUND', 'Conta não encontrada.');
}

// ---------- Painel ----------

export async function dashboard(db: D1Database, biz: BizCtx, month: string): Promise<StoreDashboard> {
  const today = todayBR();
  const in30 = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
  const b = biz.businessId;
  const [sales, items, methods, recv, pay, top, low, bdays] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total_cents), 0) AS revenue, COALESCE(SUM(discount_cents), 0) AS discount FROM biz_sales WHERE business_id = ? AND status <> 'canceled' AND substr(date, 1, 7) = ?`).bind(b, month),
    db
      .prepare(
        `SELECT COALESCE(SUM(i.total_cents), 0) AS gross,
                COALESCE(SUM(CASE WHEN i.unit_cost_cents IS NOT NULL THEN i.total_cents END), 0) AS gross_with_cost,
                COALESCE(SUM(CASE WHEN i.unit_cost_cents IS NOT NULL THEN i.total_cents - i.unit_cost_cents * i.qty END), 0) AS margin
           FROM biz_sale_items i JOIN biz_sales s ON s.id = i.sale_id WHERE s.business_id = ? AND s.status <> 'canceled' AND substr(s.date, 1, 7) = ?`,
      )
      .bind(b, month),
    db.prepare(`SELECT payment_method AS method, SUM(total_cents) AS totalCents FROM biz_sales WHERE business_id = ? AND status <> 'canceled' AND substr(date, 1, 7) = ? GROUP BY payment_method ORDER BY totalCents DESC`).bind(b, month),
    db
      .prepare(
        `SELECT s.customer_id, COALESCE(s.due_date, ?) AS due, s.total_cents - COALESCE((SELECT SUM(amount_cents) FROM biz_payments p WHERE p.sale_id = s.id), 0) AS balance
           FROM biz_sales s WHERE s.business_id = ? AND s.status = 'open'`,
      )
      .bind(today, b),
    db.prepare(`SELECT due_date AS due, amount_cents AS amount, shared FROM biz_payables WHERE business_id = ? AND status = 'open'`).bind(b),
    db
      .prepare(
        `SELECT i.description AS name, SUM(i.qty) AS qty, SUM(i.total_cents) AS revenueCents
           FROM biz_sale_items i JOIN biz_sales s ON s.id = i.sale_id WHERE s.business_id = ? AND s.status <> 'canceled' AND substr(s.date, 1, 7) = ?
          GROUP BY COALESCE(i.product_id, i.description) ORDER BY revenueCents DESC LIMIT 5`,
      )
      .bind(b, month),
    db
      .prepare(`SELECT id, name, stock_qty AS stockQty, min_stock AS minStock FROM biz_products WHERE business_id = ? AND active = 1 AND stock_qty IS NOT NULL AND min_stock IS NOT NULL AND stock_qty <= min_stock ORDER BY stock_qty - min_stock LIMIT 10`)
      .bind(b),
    db.prepare(`SELECT id, name, birthday, phone FROM biz_customers WHERE business_id = ? AND substr(birthday, 1, 2) = ? ORDER BY birthday`).bind(b, month.slice(5, 7)),
  ]);
  const s = sales!.results[0] as { n: number; revenue: number; discount: number };
  const it = items!.results[0] as { gross: number; gross_with_cost: number; margin: number };
  const receivables = recv!.results as { customer_id: string | null; due: string; balance: number }[];
  const payables = pay!.results as { due: string; amount: number; shared: number }[];

  const current = today.slice(0, 7);
  const cashMonths = [0, 1, 2].map((k) => addMonthsYm(current, k));
  const bucket = (due: string) => (due.slice(0, 7) < current ? current : due.slice(0, 7)); // atrasado entra no mês atual
  const cashflow = cashMonths.map((m) => ({
    month: m,
    inCents: receivables.filter((r) => r.balance > 0 && bucket(r.due) === m).reduce((a, r) => a + r.balance, 0),
    outCents: payables.filter((p) => bucket(p.due) === m).reduce((a, p) => a + p.amount, 0),
  }));

  // Lucro: margem dos itens com custo conhecido, menos o desconto proporcional a eles.
  const discountShare = it.gross ? Math.round(s.discount * (it.gross_with_cost / it.gross)) : 0;
  return {
    month,
    sales: {
      count: s.n,
      revenueCents: s.revenue,
      profitCents: it.margin - discountShare,
      costCoveragePct: it.gross ? Math.round((it.gross_with_cost / it.gross) * 100) : 0,
      ticketCents: s.n ? Math.round(s.revenue / s.n) : 0,
    },
    byMethod: methods!.results as StoreDashboard['byMethod'],
    receivable: {
      totalCents: receivables.reduce((a, r) => a + Math.max(0, r.balance), 0),
      overdueCents: receivables.filter((r) => r.due < today).reduce((a, r) => a + Math.max(0, r.balance), 0),
      customers: new Set(receivables.filter((r) => r.balance > 0).map((r) => r.customer_id)).size,
    },
    payable: {
      openCents: payables.reduce((a, p) => a + p.amount, 0),
      next30Cents: payables.filter((p) => p.due >= today && p.due <= in30).reduce((a, p) => a + p.amount, 0),
      overdueCents: payables.filter((p) => p.due < today).reduce((a, p) => a + p.amount, 0),
      sharedOpenCents: payables.filter((p) => p.shared).reduce((a, p) => a + p.amount, 0),
    },
    cashflow,
    topProducts: top!.results as StoreDashboard['topProducts'],
    lowStock: low!.results as StoreDashboard['lowStock'],
    birthdays: bdays!.results as StoreDashboard['birthdays'],
  };
}

// ---------- Importação da planilha ----------

/**
 * Importa a planilha atual da loja. Só roda numa loja ainda vazia (sem vendas e sem contas),
 * para não duplicar dados. Grava tudo em poucas instruções (lotes via json_each).
 */
export async function importSpreadsheet(db: D1Database, biz: BizCtx, wb: RawWorkbook, householdId: string) {
  isBizOwner(biz);
  const has = await db
    .prepare(`SELECT (SELECT COUNT(*) FROM biz_sales WHERE business_id = ?) + (SELECT COUNT(*) FROM biz_payables WHERE business_id = ?) AS n`)
    .bind(biz.businessId, biz.businessId)
    .first<{ n: number }>();
  if (has?.n) fail(409, 'CONFLICT', 'A loja já tem vendas ou contas cadastradas. A importação só roda numa loja vazia.');

  const plan: ImportPlan = mapSpreadsheet(wb, todayBR());
  const now = nowIso();
  const customerIds = new Map(plan.customers.map((c) => [c.key, newId()]));
  const productIds = new Map(plan.products.map((p) => [p.key, newId()]));
  const sales = plan.sales.map((s) => ({ ...s, id: newId() }));
  const b = biz.businessId;

  const json = (v: unknown) => JSON.stringify(v);
  await db.batch([
    db
      .prepare(
        `INSERT INTO biz_customers (id, business_id, name, created_at, updated_at)
         SELECT json_extract(value, '$.id'), ?2, json_extract(value, '$.name'), ?3, ?3 FROM json_each(?1)`,
      )
      .bind(json(plan.customers.map((c) => ({ id: customerIds.get(c.key), name: c.name }))), b, now),
    db
      .prepare(
        `INSERT INTO biz_products (id, business_id, kind, name, brand, price_cents, notes, created_at, updated_at)
         SELECT json_extract(value, '$.id'), ?2, 'product', json_extract(value, '$.name'), json_extract(value, '$.brand'),
                json_extract(value, '$.price'), 'Importado da planilha: confira marca, custo e estoque', ?3, ?3 FROM json_each(?1)`,
      )
      .bind(json(plan.products.map((p) => ({ id: productIds.get(p.key), name: p.name, brand: p.brand, price: p.priceCents }))), b, now),
    db
      .prepare(
        `INSERT INTO biz_sales (id, business_id, customer_id, date, subtotal_cents, discount_cents, total_cents, payment_method, status, due_date, notes, created_by, created_at, updated_at)
         SELECT json_extract(value, '$.id'), ?2, json_extract(value, '$.customer'), json_extract(value, '$.date'), json_extract(value, '$.total'), 0,
                json_extract(value, '$.total'), json_extract(value, '$.method'), json_extract(value, '$.status'), json_extract(value, '$.due'),
                json_extract(value, '$.notes'), ?3, ?4, ?4 FROM json_each(?1)`,
      )
      .bind(
        json(
          sales.map((s) => ({
            id: s.id,
            customer: s.customerKey ? (customerIds.get(s.customerKey) ?? null) : null,
            date: s.date,
            total: s.totalCents,
            method: s.paymentMethod,
            status: s.payments.reduce((a, p) => a + p.amountCents, 0) >= s.totalCents ? 'paid' : 'open',
            due: s.dueDate,
            notes: s.notes,
          })),
        ),
        b,
        biz.userId,
        now,
      ),
    db
      .prepare(
        `INSERT INTO biz_sale_items (id, sale_id, product_id, description, qty, unit_price_cents, unit_cost_cents, total_cents)
         SELECT json_extract(value, '$.id'), json_extract(value, '$.sale'), json_extract(value, '$.product'), json_extract(value, '$.description'),
                json_extract(value, '$.qty'), json_extract(value, '$.unit'), NULL, json_extract(value, '$.total') FROM json_each(?1)`,
      )
      .bind(
        json(
          sales.flatMap((s) =>
            s.items.map((i) => ({
              id: newId(),
              sale: s.id,
              product: i.productKey ? (productIds.get(i.productKey) ?? null) : null,
              description: i.description,
              qty: i.qty,
              unit: i.unitPriceCents,
              total: i.qty * i.unitPriceCents,
            })),
          ),
        ),
      ),
    db
      .prepare(
        `INSERT INTO biz_payments (id, sale_id, date, amount_cents, method, created_at)
         SELECT json_extract(value, '$.id'), json_extract(value, '$.sale'), json_extract(value, '$.date'), json_extract(value, '$.amount'), 'outro', ?2 FROM json_each(?1)`,
      )
      .bind(json(sales.flatMap((s) => s.payments.map((p) => ({ id: newId(), sale: s.id, date: p.date, amount: p.amountCents })))), now),
    db
      .prepare(
        `INSERT INTO biz_payables (id, business_id, supplier, due_date, amount_cents, status, paid_cents, paid_date, shared, notes, created_at, updated_at)
         SELECT json_extract(value, '$.id'), ?2, json_extract(value, '$.supplier'), json_extract(value, '$.due'), json_extract(value, '$.amount'),
                json_extract(value, '$.status'), json_extract(value, '$.paid'), json_extract(value, '$.paidDate'), json_extract(value, '$.shared'),
                json_extract(value, '$.notes'), ?3, ?3 FROM json_each(?1)`,
      )
      .bind(
        json(
          plan.payables.map((p) => ({
            id: newId(),
            supplier: p.supplier,
            due: p.dueDate,
            amount: p.amountCents,
            status: p.status,
            paid: p.paidCents,
            paidDate: p.status === 'paid' ? p.dueDate : null,
            shared: p.shared ? 1 : 0,
            notes: p.notes,
          })),
        ),
        b,
        now,
      ),
  ]);
  await audit(db, { householdId, userId: biz.userId, action: 'store.imported', target: b, details: { customers: plan.customers.length, sales: sales.length, payables: plan.payables.length } });
  return { customers: plan.customers.length, products: plan.products.length, sales: sales.length, payables: plan.payables.length, warnings: plan.warnings };
}
