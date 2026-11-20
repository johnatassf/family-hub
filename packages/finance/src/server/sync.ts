import { fail, nowIso } from '@familia/core';
import { DEFAULT_CATEGORIES, type SyncResult } from '../shared';
import { applyReferenceMonths, getCardMonth, reconcileBillPayments } from './adjust';
import { DEFAULT_RULES, type TxRow, toRow } from './classify';
import { PluggyError, type PluggyClient, type PluggyTransaction } from './pluggy';

const COOLDOWN_MS = 5 * 60 * 1000;
/** Depois de uma falha, libera nova tentativa em 1 minuto. */
const RETRY_AFTER_FAILURE_MS = 60 * 1000;
/** Linhas por instrução de upsert (o lote vai como um único parâmetro JSON). */
const CHUNK = 200;
/**
 * Margem do `createdAtFrom` na busca incremental: cobre diferença de relógio com a Pluggy e lançamentos
 * que ela gravou enquanto a sincronização anterior rodava. Rebuscar 1 dia de novidades custa pouco (upsert).
 */
const CREATED_AT_MARGIN_MS = 24 * 60 * 60 * 1000;
/** Pendentes reconsultadas por chamada (id = 36 caracteres; 100 deixam a URL em ~4 KB). */
const IDS_PER_REQUEST = 100;

export interface ItemRow {
  id: string;
  household_id: string;
  owner_user_id: string;
  pluggy_item_id: string;
}

/** Categorias e regras padrão da família, criadas no primeiro uso do módulo. */
export async function ensureFinanceDefaults(db: D1Database, householdId: string) {
  const has = await db.prepare(`SELECT 1 FROM fin_categories WHERE household_id = ? LIMIT 1`).bind(householdId).first();
  if (has) return;
  const now = nowIso();
  await db.batch([
    ...DEFAULT_CATEGORIES.map((name, i) =>
      db.prepare(`INSERT OR IGNORE INTO fin_categories (household_id, name, sort_order) VALUES (?, ?, ?)`).bind(householdId, name, i),
    ),
    ...DEFAULT_RULES.map(([pattern, category], i) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO fin_category_rules (household_id, pattern, category, priority, created_at) VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(householdId, pattern, category, i, now),
    ),
  ]);
}

export async function loadRules(db: D1Database, householdId: string) {
  const { results } = await db
    .prepare(`SELECT pattern, category FROM fin_category_rules WHERE household_id = ? ORDER BY priority, id`)
    .bind(householdId)
    .all<{ pattern: string; category: string }>();
  return results;
}

const UPSERT_ACCOUNTS = `
INSERT INTO fin_accounts (id, item_id, household_id, owner_user_id, type, subtype, name, number, balance_cents, credit_limit_cents,
       available_limit_cents, due_date, minimum_payment_cents, created_at, updated_at)
SELECT json_extract(value, '$.id'), ?2, ?3, ?4, json_extract(value, '$.type'), json_extract(value, '$.subtype'),
       json_extract(value, '$.name'), json_extract(value, '$.number'), json_extract(value, '$.balanceCents'),
       json_extract(value, '$.creditLimitCents'), json_extract(value, '$.availableLimitCents'), json_extract(value, '$.dueDate'),
       json_extract(value, '$.minimumPaymentCents'), ?5, ?5
  FROM json_each(?1) WHERE true
ON CONFLICT(id) DO UPDATE SET type = excluded.type, subtype = excluded.subtype, name = excluded.name,
       number = excluded.number, balance_cents = excluded.balance_cents, credit_limit_cents = excluded.credit_limit_cents,
       available_limit_cents = excluded.available_limit_cents, due_date = excluded.due_date,
       minimum_payment_cents = excluded.minimum_payment_cents, updated_at = excluded.updated_at
 WHERE fin_accounts.item_id = excluded.item_id`;

// Na atualização, NUNCA sobrescreve categoria, mês de referência, exclusão, confiança nem quem gastou
// (edições manuais), igual ao app Python.
const UPSERT_TRANSACTIONS = `
INSERT INTO fin_transactions (id, account_id, household_id, description, amount_cents, date, reference_month, account_type,
       category, installment, excluded, confidence, status, bill_id, bill_forecast_date, card_last4, purchase_date, created_at, updated_at)
SELECT json_extract(value, '$.id'), ?2, ?3, json_extract(value, '$.description'), json_extract(value, '$.amountCents'),
       json_extract(value, '$.date'), json_extract(value, '$.referenceMonth'), ?4, json_extract(value, '$.category'),
       json_extract(value, '$.installment'), json_extract(value, '$.excluded'), json_extract(value, '$.confidence'),
       json_extract(value, '$.status'), json_extract(value, '$.billId'), json_extract(value, '$.billForecastDate'),
       json_extract(value, '$.cardLast4'), json_extract(value, '$.purchaseDate'), ?5, ?5
  FROM json_each(?1) WHERE true
ON CONFLICT(id) DO UPDATE SET description = excluded.description, amount_cents = excluded.amount_cents, date = excluded.date,
       status = excluded.status, bill_id = excluded.bill_id, bill_forecast_date = excluded.bill_forecast_date,
       card_last4 = excluded.card_last4, purchase_date = excluded.purchase_date, updated_at = excluded.updated_at
 WHERE fin_transactions.account_id = excluded.account_id`;

const UPSERT_BILLS = `
INSERT INTO fin_bills (id, account_id, household_id, due_date, closing_date, total_cents, minimum_cents, updated_at)
SELECT json_extract(value, '$.id'), ?2, ?3, json_extract(value, '$.dueDate'), json_extract(value, '$.closingDate'),
       json_extract(value, '$.totalCents'), json_extract(value, '$.minimumCents'), ?4
  FROM json_each(?1) WHERE true
ON CONFLICT(id) DO UPDATE SET due_date = excluded.due_date, closing_date = excluded.closing_date, total_cents = excluded.total_cents,
       minimum_cents = excluded.minimum_cents, updated_at = excluded.updated_at
 WHERE fin_bills.account_id = excluded.account_id`;

const cents = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(v * 100));
const day = (v: string | null | undefined) => (v ? v.slice(0, 10) : null);

async function pendingIds(db: D1Database, accountId: string) {
  const { results } = await db
    .prepare(`SELECT id FROM fin_transactions WHERE account_id = ? AND status = 'PENDING'`)
    .bind(accountId)
    .all<{ id: string }>();
  return results.map((r) => r.id);
}

/**
 * Sincroniza um item: conta(s), faturas e transações via /v2/transactions (cursor).
 *
 * Transações, por conta:
 * - primeira vez (ou `full`): histórico inteiro;
 * - depois: só o que a Pluggy recebeu desde a última busca (`createdAtFrom`, pega também lançamento novo com
 *   data antiga) + reconsulta pelo id das que estavam PENDENTES (pendente → lançada, parcela futura que entrou
 *   na fatura). A Pluggy mantém o id nessas mudanças. Lançada que muda depois (raro) só vem no "Buscar tudo".
 *
 * Trava de 5 min por item (atômica no D1) evita abuso e sincronizações simultâneas.
 */
export async function syncItem(
  db: D1Database,
  pluggy: PluggyClient,
  item: ItemRow,
  trigger: 'manual' | 'cron',
  opts: { full?: boolean } = {},
): Promise<SyncResult> {
  const started = nowIso();
  const lock = await db
    .prepare(
      `UPDATE fin_items SET last_sync_started_at = ?
        WHERE id = ? AND (last_sync_started_at IS NULL OR last_sync_started_at < ?)`,
    )
    .bind(started, item.id, new Date(Date.now() - COOLDOWN_MS).toISOString())
    .run();
  if (!lock.meta.changes) fail(429, 'RATE_LIMITED', 'Esta conexão foi sincronizada há pouco. Aguarde alguns minutos.');

  const run = await db
    .prepare(
      `INSERT INTO fin_sync_runs (item_id, household_id, trigger, started_at, status) VALUES (?, ?, ?, ?, 'running') RETURNING id`,
    )
    .bind(item.id, item.household_id, trigger, started)
    .first<{ id: number }>();

  let processed = 0;
  let full = false;
  try {
    const remote = await pluggy.getItem(item.pluggy_item_id);
    const accounts = await pluggy.listAccounts(item.pluggy_item_id);
    const now = nowIso();
    if (accounts.length) {
      await db
        .prepare(UPSERT_ACCOUNTS)
        .bind(
          JSON.stringify(
            accounts.map((a) => ({
              id: a.id,
              type: a.type ?? null,
              subtype: a.subtype ?? null,
              name: a.name ?? null,
              number: a.number ?? null,
              balanceCents: cents(a.balance),
              creditLimitCents: cents(a.creditData?.creditLimit),
              availableLimitCents: cents(a.creditData?.availableCreditLimit),
              dueDate: day(a.creditData?.balanceDueDate),
              minimumPaymentCents: cents(a.creditData?.minimumPayment),
            })),
          ),
          item.id,
          item.household_id,
          item.owner_user_id,
          now,
        )
        .run();
    }

    await ensureFinanceDefaults(db, item.household_id);
    const rules = await loadRules(db, item.household_id);
    // Até quando cada conta já está em dia (NULL = nunca buscou: vai o histórico inteiro).
    const { results: known } = await db
      .prepare(`SELECT id, tx_synced_at FROM fin_accounts WHERE item_id = ?`)
      .bind(item.id)
      .all<{ id: string; tx_synced_at: string | null }>();
    const syncedAt = new Map(known.map((a) => [a.id, a.tx_synced_at]));

    for (const account of accounts) {
      if (account.type === 'CREDIT') {
        const bills = await pluggy.listBills(account.id);
        if (bills.length) {
          await db
            .prepare(UPSERT_BILLS)
            .bind(
              JSON.stringify(
                bills.map((b) => ({
                  id: b.id,
                  dueDate: day(b.dueDate),
                  closingDate: day(b.billClosingDate),
                  totalCents: cents(b.totalAmount),
                  minimumCents: cents(b.minimumPaymentAmount),
                })),
              ),
              account.id,
              item.household_id,
              nowIso(),
            )
            .run();
        }
      }
      const seen = new Set<string>();
      const save = async (txs: PluggyTransaction[]) => {
        const rows = txs.map((t) => toRow(t, rules, account.type)).filter((r): r is TxRow => r !== null);
        for (let i = 0; i < rows.length; i += CHUNK) {
          const chunk = rows.slice(i, i + CHUNK);
          await db.prepare(UPSERT_TRANSACTIONS).bind(JSON.stringify(chunk), account.id, item.household_id, account.type ?? null, nowIso()).run();
          processed += chunk.length;
        }
        for (const r of rows) seen.add(r.id);
      };

      const since = opts.full ? null : syncedAt.get(account.id);
      if (!since) {
        full = true;
        await pluggy.forEachTransactionPage(account.id, save);
      } else {
        const pending = await pendingIds(db, account.id);
        await pluggy.forEachTransactionPage(account.id, save, { createdAtFrom: new Date(Date.parse(since) - CREATED_AT_MARGIN_MS) });
        // As que já vieram entre as novas não precisam ser reconsultadas. Pendente que sumiu da Pluggy
        // continua aqui (a Pluggy avisa que um sumiço pode ser temporário) e segue sendo reconsultada.
        const stale = pending.filter((id) => !seen.has(id));
        for (let i = 0; i < stale.length; i += IDS_PER_REQUEST) {
          await pluggy.forEachTransactionPage(account.id, save, { ids: stale.slice(i, i + IDS_PER_REQUEST) });
        }
      }
      // Só avança depois de buscar tudo da conta: se falhar no meio, a próxima rodada recomeça do ponto anterior.
      await db.prepare(`UPDATE fin_accounts SET tx_synced_at = ? WHERE id = ? AND item_id = ?`).bind(started, account.id, item.id).run();
    }

    // Cartões no mês da fatura (ou da compra, conforme a família) e pagamento de fatura feito pela conta
    // corrente com texto genérico. Em SQL no D1, sem custo de CPU no Worker.
    if (accounts.length) {
      await applyReferenceMonths(db, item.household_id, await getCardMonth(db, item.household_id), accounts.map((a) => a.id));
    }
    await reconcileBillPayments(db, item.household_id);

    const finished = nowIso();
    await db.batch([
      db
        .prepare(`UPDATE fin_items SET status = ?, connector_name = ?, last_sync_at = ?, last_error = NULL WHERE id = ?`)
        .bind(remote.status ?? null, remote.connector?.name ?? null, finished, item.id),
      db.prepare(`UPDATE fin_sync_runs SET status = 'ok', finished_at = ?, processed = ? WHERE id = ?`).bind(finished, processed, run?.id ?? 0),
    ]);
    return { itemId: item.id, processed, accounts: accounts.length, full };
  } catch (e) {
    const message = e instanceof PluggyError ? e.message : 'Falha inesperada ao sincronizar.';
    if (!(e instanceof PluggyError)) console.error('[finance] sync', e);
    const retryAt = new Date(Date.now() - COOLDOWN_MS + RETRY_AFTER_FAILURE_MS).toISOString();
    await db.batch([
      db.prepare(`UPDATE fin_items SET last_error = ?, last_sync_started_at = ? WHERE id = ?`).bind(message.slice(0, 500), retryAt, item.id),
      db
        .prepare(`UPDATE fin_sync_runs SET status = 'error', finished_at = ?, processed = ?, error = ? WHERE id = ?`)
        .bind(nowIso(), processed, message.slice(0, 500), run?.id ?? 0),
    ]);
    return fail(502, 'UPSTREAM', message);
  }
}

/** Cron diário: sincroniza conexões sem atualização nas últimas 20 h (no máximo `limit` por execução). */
export async function syncDueItems(db: D1Database, pluggy: PluggyClient, limit = 25) {
  const { results } = await db
    .prepare(
      `SELECT id, household_id, owner_user_id, pluggy_item_id FROM fin_items
        WHERE last_sync_at IS NULL OR last_sync_at < ? ORDER BY last_sync_at LIMIT ?`,
    )
    .bind(new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString(), limit)
    .all<ItemRow>();
  const out: SyncResult[] = [];
  for (const item of results) {
    try {
      out.push(await syncItem(db, pluggy, item, 'cron'));
    } catch (e) {
      out.push({ itemId: item.id, processed: 0, accounts: 0, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
