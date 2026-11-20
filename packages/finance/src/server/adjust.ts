// Ajustes feitos direto no D1 depois de gravar lançamentos (e ao trocar a configuração da família).
// Rodam em SQL para não gastar CPU do Worker. A migration 0007 aplica os mesmos ajustes ao que já existia.
import { nowIso } from '@familia/core';
import type { CardMonth } from '../shared';

/** Mês da fatura de um lançamento de cartão: vencimento da fatura ligada; senão a fatura prevista; senão o mês da compra. */
const BILL_MONTH = `COALESCE(
  (SELECT substr(b.due_date, 1, 7) FROM fin_bills b WHERE b.id = fin_transactions.bill_id),
  substr(fin_transactions.bill_forecast_date, 1, 7),
  substr(fin_transactions.date, 1, 7))`;
const TARGET_MONTH = `CASE WHEN ?2 = 'bill' THEN ${BILL_MONTH} ELSE substr(fin_transactions.date, 1, 7) END`;

export async function getCardMonth(db: D1Database, householdId: string): Promise<CardMonth> {
  const row = await db.prepare(`SELECT card_month FROM plan_settings WHERE household_id = ?`).bind(householdId).first<{ card_month: CardMonth }>();
  return row?.card_month ?? 'bill';
}

/**
 * Mês de referência dos lançamentos de cartão conforme a família escolheu: mês da fatura (igual ao app do
 * banco; parcelas futuras caem no mês em que serão pagas) ou mês da compra. Mês editado à mão não muda.
 * Só grava as linhas que mudam (o plano gratuito do D1 conta linhas gravadas).
 */
export async function applyReferenceMonths(db: D1Database, householdId: string, mode: CardMonth, accountIds?: string[]) {
  const onlyAccounts = accountIds ? `AND account_id IN (SELECT value FROM json_each(?3))` : '';
  const stmt = db.prepare(
    `UPDATE fin_transactions SET reference_month = ${TARGET_MONTH}
      WHERE household_id = ?1 AND account_type = 'CREDIT' AND reference_month_manual = 0 ${onlyAccounts}
        AND reference_month IS NOT ${TARGET_MONTH}`,
  );
  await (accountIds ? stmt.bind(householdId, mode, JSON.stringify(accountIds)) : stmt.bind(householdId, mode)).run();
}

/**
 * Pagamento de fatura feito pela conta corrente com texto genérico (ex.: "Pagamento efetuado|BANCO INTER SA"):
 * se o mesmo valor entrou como pagamento num cartão da família em até 3 dias, é transferência entre contas
 * da família e sai do total, como o lado do cartão. Edição manual nunca é tocada.
 */
export async function reconcileBillPayments(db: D1Database, householdId: string) {
  await db
    .prepare(
      `UPDATE fin_transactions SET category = 'Transferências', excluded = 1, confidence = 'Alta', updated_at = ?2
        WHERE household_id = ?1 AND COALESCE(account_type, '') <> 'CREDIT' AND amount_cents < 0
          AND excluded = 0 AND confidence <> 'Manual'
          AND EXISTS (SELECT 1 FROM fin_transactions c
                       WHERE c.household_id = ?1 AND c.account_type = 'CREDIT' AND c.excluded = 1
                         AND c.category = 'Transferências' AND c.amount_cents = -fin_transactions.amount_cents
                         AND abs(julianday(c.date) - julianday(fin_transactions.date)) <= 3)`,
    )
    .bind(householdId, nowIso())
    .run();
}
