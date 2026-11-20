// Regras de negócio do financeiro. Recebem um RequestCtx já autorizado; usadas pelas rotas
// (e, no futuro, por um servidor MCP) sem duplicar regra de acesso.
import { type RequestCtx, audit, fail, isMember, newId, nowIso } from '@familia/core';
import { isManager } from '@familia/shared';
import type { FinAccount, FinCategoriesResponse, FinItem, FinSummary, FinTransaction, Visibility } from '../shared';
import { type TxFilters, txWhere, visibleAccounts } from './access';
import { norm } from './classify';
import { type FinanceEnv, membersCanConnect } from './env';
import { PluggyError, type PluggyClient } from './pluggy';
import { type ItemRow, ensureFinanceDefaults, syncItem } from './sync';

const auditCtx = (ctx: RequestCtx) => ({ householdId: ctx.householdId, userId: ctx.userId, ip: ctx.ip, userAgent: ctx.userAgent });

// ---------- Transações ----------

interface TxDbRow {
  id: string;
  account_id: string;
  account_name: string | null;
  account_nickname: string | null;
  owner_user_id: string;
  owner_name: string;
  assigned_user_id: string | null;
  assigned_name: string | null;
  description: string;
  amount_cents: number;
  date: string;
  reference_month: string;
  account_type: string | null;
  category: string;
  installment: string;
  excluded: number;
  confidence: FinTransaction['confidence'];
  status: string | null;
  card_last4: string | null;
}

const TX_SELECT = `
SELECT t.id, t.account_id, a.name AS account_name, a.nickname AS account_nickname, a.owner_user_id, ou.name AS owner_name,
       t.assigned_user_id, au.name AS assigned_name, t.description, t.amount_cents, t.date, t.reference_month,
       t.account_type, t.category, t.installment, t.excluded, t.confidence, t.status, t.card_last4
  FROM fin_transactions t
  JOIN fin_accounts a ON a.id = t.account_id
  JOIN "user" ou ON ou.id = a.owner_user_id
  LEFT JOIN "user" au ON au.id = t.assigned_user_id`;

const toTx = (ctx: RequestCtx, r: TxDbRow): FinTransaction => ({
  id: r.id,
  accountId: r.account_id,
  accountLabel: r.account_nickname || r.account_name || 'Conta',
  ownerUserId: r.owner_user_id,
  ownerName: r.owner_name,
  assignedUserId: r.assigned_user_id,
  spenderName: r.assigned_name ?? r.owner_name,
  editable: r.owner_user_id === ctx.userId,
  description: r.description,
  amountCents: r.amount_cents,
  date: r.date,
  referenceMonth: r.reference_month,
  accountType: r.account_type,
  category: r.category,
  installment: r.installment,
  excluded: Boolean(r.excluded),
  confidence: r.confidence,
  status: r.status,
  cardLast4: r.card_last4,
});

export async function listTransactions(db: D1Database, ctx: RequestCtx, f: TxFilters, limit = 1000, offset = 0) {
  const w = txWhere(ctx, f);
  const { results } = await db
    .prepare(`${TX_SELECT} WHERE ${w.sql} ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?`)
    .bind(...w.params, limit, offset)
    .all<TxDbRow>();
  return results.map((r) => toTx(ctx, r));
}

export async function summary(db: D1Database, ctx: RequestCtx, f: TxFilters): Promise<FinSummary> {
  // Série mensal: todos os meses. Categorias, pessoas e contagens: só o mês pedido (se houver).
  const w = txWhere(ctx, { scope: f.scope, member: f.member, accountId: f.accountId });
  const wm = txWhere(ctx, { scope: f.scope, member: f.member, accountId: f.accountId, month: f.month });
  const joins = `FROM fin_transactions t JOIN fin_accounts a ON a.id = t.account_id`;
  const from = `${joins} WHERE ${w.sql}`;
  const fromMonth = `${joins} WHERE ${wm.sql}`;
  const [months, categories, byPerson, counts] = await db.batch([
    db
      .prepare(
        `SELECT t.reference_month AS month,
                SUM(CASE WHEN t.amount_cents < 0 THEN -t.amount_cents ELSE 0 END) AS expensesCents,
                SUM(CASE WHEN t.amount_cents > 0 THEN t.amount_cents ELSE 0 END) AS incomeCents,
                SUM(t.amount_cents) AS netCents
           ${from} AND t.excluded = 0 GROUP BY t.reference_month ORDER BY t.reference_month`,
      )
      .bind(...w.params),
    db
      .prepare(
        `SELECT t.category, SUM(-t.amount_cents) AS totalCents ${fromMonth} AND t.excluded = 0 AND t.amount_cents < 0
          GROUP BY t.category ORDER BY totalCents DESC`,
      )
      .bind(...wm.params),
    db
      .prepare(
        `SELECT p.id AS userId, p.name, SUM(-t.amount_cents) AS expensesCents
           ${joins} JOIN "user" p ON p.id = COALESCE(t.assigned_user_id, a.owner_user_id)
          WHERE ${wm.sql} AND t.excluded = 0 AND t.amount_cents < 0
          GROUP BY p.id, p.name ORDER BY expensesCents DESC`,
      )
      .bind(...wm.params),
    db
      .prepare(
        `SELECT count(*) AS total,
                SUM(CASE WHEN t.confidence = 'Baixa' OR t.category = 'Outros' THEN 1 ELSE 0 END) AS review ${fromMonth}`,
      )
      .bind(...wm.params),
  ]);
  const c = (counts?.results[0] ?? {}) as { total?: number; review?: number };
  return {
    months: (months?.results ?? []) as FinSummary['months'],
    categories: (categories?.results ?? []) as FinSummary['categories'],
    byPerson: (byPerson?.results ?? []) as FinSummary['byPerson'],
    total: c.total ?? 0,
    review: c.review ?? 0,
  };
}

export interface TxPatch {
  category?: string;
  referenceMonth?: string;
  excluded?: boolean;
  assignedUserId?: string | null;
}

/** Só o dono da conta edita. Para qualquer outra pessoa a transação "não existe" (404, sem vazar). */
export async function editTransaction(db: D1Database, ctx: RequestCtx, txId: string, patch: TxPatch) {
  const v = visibleAccounts(ctx);
  const row = await db
    .prepare(`SELECT a.owner_user_id FROM fin_transactions t JOIN fin_accounts a ON a.id = t.account_id WHERE t.id = ? AND ${v.sql}`)
    .bind(txId, ...v.params)
    .first<{ owner_user_id: string }>();
  if (!row || row.owner_user_id !== ctx.userId) fail(404, 'NOT_FOUND', 'Transação não encontrada.');

  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (patch.category !== undefined) {
    await ensureFinanceDefaults(db, ctx.householdId);
    const ok = await db
      .prepare(`SELECT 1 FROM fin_categories WHERE household_id = ? AND name = ?`)
      .bind(ctx.householdId, patch.category)
      .first();
    if (!ok) fail(400, 'VALIDATION', 'Categoria inválida.');
    sets.push('category = ?');
    params.push(patch.category);
  }
  if (patch.referenceMonth !== undefined) {
    // Marcado como manual: não muda quando a família troca entre mês da fatura e mês da compra.
    sets.push('reference_month = ?', 'reference_month_manual = 1');
    params.push(patch.referenceMonth);
  }
  if (patch.excluded !== undefined) {
    sets.push('excluded = ?');
    params.push(patch.excluded ? 1 : 0);
  }
  if (sets.length) sets.push(`confidence = 'Manual'`);
  if (patch.assignedUserId !== undefined) {
    if (patch.assignedUserId !== null && !(await isMember(db, ctx.householdId, patch.assignedUserId))) {
      fail(400, 'VALIDATION', 'Essa pessoa não faz parte da família.');
    }
    sets.push('assigned_user_id = ?');
    params.push(patch.assignedUserId);
  }
  if (!sets.length) fail(400, 'VALIDATION', 'Nenhuma alteração.');
  sets.push('updated_at = ?');
  params.push(nowIso());
  await db.prepare(`UPDATE fin_transactions SET ${sets.join(', ')} WHERE id = ?`).bind(...params, txId).run();
}

// ---------- Contas ----------

export async function listAccounts(db: D1Database, ctx: RequestCtx): Promise<FinAccount[]> {
  const v = visibleAccounts(ctx);
  const { results } = await db
    .prepare(
      `SELECT a.id, a.item_id AS itemId, a.owner_user_id AS ownerUserId, u.name AS ownerName, a.type, a.subtype, a.name,
              a.number, a.nickname, a.visibility, i.connector_name AS connectorName, i.last_sync_at AS lastSyncAt,
              (SELECT count(*) FROM fin_transactions t WHERE t.account_id = a.id) AS transactions,
              a.balance_cents AS balanceCents, a.credit_limit_cents AS creditLimitCents, a.available_limit_cents AS availableLimitCents,
              a.due_date AS dueDate, a.minimum_payment_cents AS minimumPaymentCents
         FROM fin_accounts a JOIN fin_items i ON i.id = a.item_id JOIN "user" u ON u.id = a.owner_user_id
        WHERE ${v.sql} ORDER BY (a.owner_user_id = ?) DESC, u.name, a.name`,
    )
    .bind(...v.params, ctx.userId)
    .all<Omit<FinAccount, 'isMine'>>();
  return results.map((a) => ({ ...a, isMine: a.ownerUserId === ctx.userId }));
}

export async function updateAccount(db: D1Database, ctx: RequestCtx, accountId: string, patch: { visibility?: Visibility; nickname?: string | null }) {
  const acc = await db
    .prepare(`SELECT visibility FROM fin_accounts WHERE id = ? AND household_id = ? AND owner_user_id = ?`)
    .bind(accountId, ctx.householdId, ctx.userId)
    .first<{ visibility: Visibility }>();
  if (!acc) fail(404, 'NOT_FOUND', 'Conta não encontrada.');
  const sets: string[] = [];
  const params: (string | null)[] = [];
  if (patch.visibility !== undefined) {
    sets.push('visibility = ?');
    params.push(patch.visibility);
  }
  if (patch.nickname !== undefined) {
    sets.push('nickname = ?');
    params.push(patch.nickname?.trim() || null);
  }
  if (!sets.length) fail(400, 'VALIDATION', 'Nenhuma alteração.');
  await db.prepare(`UPDATE fin_accounts SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).bind(...params, nowIso(), accountId).run();
  if (patch.visibility !== undefined && patch.visibility !== acc!.visibility) {
    await audit(db, {
      ...auditCtx(ctx),
      action: patch.visibility === 'family' ? 'finance.account_shared' : 'finance.account_unshared',
      target: accountId,
    });
  }
}

// ---------- Conexões (itens Pluggy) ----------

export async function listItems(db: D1Database, ctx: RequestCtx): Promise<FinItem[]> {
  const manager = isManager(ctx.role);
  const { results } = await db
    .prepare(
      `SELECT i.id, i.pluggy_item_id, i.owner_user_id, u.name AS owner_name, i.connector_name, i.status, i.last_sync_at, i.last_error,
              (SELECT count(*) FROM fin_accounts a WHERE a.item_id = i.id) AS accounts
         FROM fin_items i JOIN "user" u ON u.id = i.owner_user_id
        WHERE i.household_id = ? AND (i.owner_user_id = ? OR ?)
        ORDER BY i.created_at`,
    )
    .bind(ctx.householdId, ctx.userId, manager ? 1 : 0)
    .all<{
      id: string;
      pluggy_item_id: string;
      owner_user_id: string;
      owner_name: string;
      connector_name: string | null;
      status: string | null;
      last_sync_at: string | null;
      last_error: string | null;
      accounts: number;
    }>();
  return results.map((r) => {
    const mine = r.owner_user_id === ctx.userId;
    return {
      id: r.id,
      pluggyItemId: mine ? r.pluggy_item_id : null,
      ownerUserId: r.owner_user_id,
      ownerName: r.owner_name,
      isMine: mine,
      connectorName: r.connector_name,
      status: r.status,
      lastSyncAt: r.last_sync_at,
      lastError: mine ? r.last_error : r.last_error ? 'Erro na última sincronização' : null,
      accounts: r.accounts,
    };
  });
}

/**
 * Cadastro manual de itemId (modo atual, Meu Pluggy). Proteções:
 * - o item é conferido na Pluggy antes de salvar (itemId inexistente nunca entra);
 * - um item só pode ter um dono em toda a plataforma (UNIQUE), então ninguém "pega" a conexão de outra pessoa;
 * - na fase interna, só dono/admin cadastra (FINANCE_MEMBERS_CAN_CONNECT libera).
 */
export async function addItem(
  env: FinanceEnv,
  ctx: RequestCtx,
  getPluggy: () => PluggyClient,
  input: { pluggyItemId: string; ownerUserId?: string },
) {
  if (!isManager(ctx.role) && !membersCanConnect(env)) fail(403, 'FORBIDDEN', 'Peça a um administrador(a) da família para cadastrar a conexão.');
  const ownerUserId = input.ownerUserId ?? ctx.userId;
  if (ownerUserId !== ctx.userId) {
    if (!isManager(ctx.role)) fail(403, 'FORBIDDEN', 'Você só pode cadastrar conexões para você.');
    if (!(await isMember(env.DB, ctx.householdId, ownerUserId))) fail(400, 'VALIDATION', 'Essa pessoa não faz parte da família.');
  }
  const exists = await env.DB.prepare(`SELECT 1 FROM fin_items WHERE pluggy_item_id = ?`).bind(input.pluggyItemId).first();
  if (exists) fail(409, 'CONFLICT', 'Essa conexão já está cadastrada.');

  let remote;
  try {
    remote = await getPluggy().getItem(input.pluggyItemId);
  } catch (e) {
    if (e instanceof PluggyError && (e.status === 404 || e.status === 400)) fail(400, 'VALIDATION', 'itemId não encontrado na Pluggy. Confira o ID no Meu Pluggy.');
    throw e;
  }
  const id = newId();
  try {
    await env.DB.prepare(
      `INSERT INTO fin_items (id, household_id, owner_user_id, pluggy_item_id, connector_name, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, ctx.householdId, ownerUserId, input.pluggyItemId, remote.connector?.name ?? null, remote.status ?? null, nowIso())
      .run();
  } catch (e) {
    if (String(e).includes('UNIQUE')) fail(409, 'CONFLICT', 'Essa conexão já está cadastrada.');
    throw e;
  }
  await audit(env.DB, { ...auditCtx(ctx), action: 'finance.item_added', target: id, details: { ownerUserId, connector: remote.connector?.name } });
  return { id };
}

async function getItemForManage(db: D1Database, ctx: RequestCtx, itemId: string) {
  const item = await db
    .prepare(`SELECT id, household_id, owner_user_id, pluggy_item_id FROM fin_items WHERE id = ? AND household_id = ?`)
    .bind(itemId, ctx.householdId)
    .first<ItemRow>();
  if (!item || (item.owner_user_id !== ctx.userId && !isManager(ctx.role))) fail(404, 'NOT_FOUND', 'Conexão não encontrada.');
  return item!;
}

/** Desconectar: apaga os dados locais e, com revoke, revoga a conexão na Pluggy (LGPD). */
export async function removeItem(env: FinanceEnv, ctx: RequestCtx, pluggy: PluggyClient | null, itemId: string, revoke: boolean) {
  const item = await getItemForManage(env.DB, ctx, itemId);
  if (revoke && pluggy) await deleteAtPluggy(pluggy, item.pluggy_item_id);
  await env.DB.prepare(`DELETE FROM fin_items WHERE id = ?`).bind(item.id).run();
  await audit(env.DB, { ...auditCtx(ctx), action: 'finance.item_removed', target: item.id, details: { revoked: revoke } });
}

export async function syncOne(env: FinanceEnv, ctx: RequestCtx, getPluggy: () => PluggyClient, itemId: string, opts: { full?: boolean } = {}) {
  const item = await getItemForManage(env.DB, ctx, itemId);
  const result = await syncItem(env.DB, getPluggy(), item, 'manual', opts);
  await audit(env.DB, { ...auditCtx(ctx), action: 'finance.synced', target: item.id, details: { processed: result.processed, full: result.full } });
  return result;
}

export async function deleteAtPluggy(pluggy: PluggyClient, pluggyItemId: string) {
  try {
    await pluggy.deleteItem(pluggyItemId);
  } catch (e) {
    if (!(e instanceof PluggyError && e.status === 404)) throw e;
  }
}

// ---------- Categorias e regras ----------

export async function listCategories(db: D1Database, ctx: RequestCtx): Promise<FinCategoriesResponse> {
  await ensureFinanceDefaults(db, ctx.householdId);
  const [cats, rules] = await db.batch([
    db.prepare(`SELECT name FROM fin_categories WHERE household_id = ? ORDER BY sort_order, name`).bind(ctx.householdId),
    db.prepare(`SELECT id, pattern, category FROM fin_category_rules WHERE household_id = ? ORDER BY priority, id`).bind(ctx.householdId),
  ]);
  return {
    categories: (cats?.results as { name: string }[]).map((c) => c.name),
    rules: rules?.results as FinCategoriesResponse['rules'],
  };
}

const requireManager = (ctx: RequestCtx) => {
  if (!isManager(ctx.role)) fail(403, 'FORBIDDEN', 'Apenas dono(a) ou administrador(a) altera categorias e regras.');
};

export async function addCategory(db: D1Database, ctx: RequestCtx, name: string) {
  requireManager(ctx);
  await ensureFinanceDefaults(db, ctx.householdId);
  await db
    .prepare(
      `INSERT OR IGNORE INTO fin_categories (household_id, name, sort_order)
       VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM fin_categories WHERE household_id = ?))`,
    )
    .bind(ctx.householdId, name, ctx.householdId)
    .run();
}

export async function addRule(db: D1Database, ctx: RequestCtx, pattern: string, category: string) {
  requireManager(ctx);
  await ensureFinanceDefaults(db, ctx.householdId);
  const cat = await db.prepare(`SELECT 1 FROM fin_categories WHERE household_id = ? AND name = ?`).bind(ctx.householdId, category).first();
  if (!cat) fail(400, 'VALIDATION', 'Categoria inválida.');
  const normalized = norm(pattern);
  if (normalized.length < 2) fail(400, 'VALIDATION', 'Padrão muito curto.');
  try {
    await db
      .prepare(
        `INSERT INTO fin_category_rules (household_id, pattern, category, priority, created_at)
         VALUES (?, ?, ?, (SELECT COALESCE(MAX(priority), 0) + 1 FROM fin_category_rules WHERE household_id = ?), ?)`,
      )
      .bind(ctx.householdId, normalized, category, ctx.householdId, nowIso())
      .run();
  } catch (e) {
    if (String(e).includes('UNIQUE')) fail(409, 'CONFLICT', 'Já existe uma regra com esse padrão.');
    throw e;
  }
}

export async function deleteRule(db: D1Database, ctx: RequestCtx, ruleId: number) {
  requireManager(ctx);
  const res = await db.prepare(`DELETE FROM fin_category_rules WHERE id = ? AND household_id = ?`).bind(ruleId, ctx.householdId).run();
  if (!res.meta.changes) fail(404, 'NOT_FOUND', 'Regra não encontrada.');
}

// ---------- Exportação ----------

const csvCell = (v: unknown) => {
  let s = v === null || v === undefined ? '' : String(v);
  // Evita injeção de fórmula no Excel/Sheets (números negativos continuam números).
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function exportCsv(db: D1Database, ctx: RequestCtx, f: TxFilters) {
  const rows = await listTransactions(db, ctx, f, 50_000);
  const header = ['Data de referência', 'Mês', 'Conta', 'Dono(a)', 'Quem gastou', 'Descrição', 'Valor', 'Tipo', 'Categoria', 'Parcela', 'Excluído', 'Confiança', 'Cartão', 'Pluggy ID'];
  const lines = rows.map((r) =>
    [
      r.date, r.referenceMonth, r.accountLabel, r.ownerName, r.spenderName, r.description, (r.amountCents / 100).toFixed(2),
      r.accountType, r.category, r.installment, r.excluded ? 'Sim' : 'Não', r.confidence, r.cardLast4, r.id,
    ]
      .map(csvCell)
      .join(','),
  );
  await audit(db, { ...auditCtx(ctx), action: 'finance.exported', details: { rows: rows.length } });
  return '﻿' + [header.join(','), ...lines].join('\r\n');
}
