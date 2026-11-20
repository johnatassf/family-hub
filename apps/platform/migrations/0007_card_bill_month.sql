-- Cartões contados no mês da fatura (como no app do banco) e pagamentos de fatura que entravam como gasto.
-- As mesmas regras valem para lançamentos novos (classify.ts e adjust.ts); aqui corrigem os que já existem.
-- Lançamentos editados à mão (confidence = 'Manual') nunca são tocados.

-- Mês de referência editado à mão: não muda quando a família troca entre mês da fatura e mês da compra.
ALTER TABLE fin_transactions ADD COLUMN reference_month_manual INTEGER NOT NULL DEFAULT 0;
UPDATE fin_transactions SET reference_month_manual = 1
 WHERE confidence = 'Manual' AND reference_month <> substr(date, 1, 7);

-- 'bill' = cartões contam no mês da fatura (padrão); 'purchase' = no mês da compra.
ALTER TABLE plan_settings ADD COLUMN card_month TEXT NOT NULL DEFAULT 'bill' CHECK (card_month IN ('bill', 'purchase'));

-- Pagamento da fatura do lado do cartão sem operationType (ex.: "pagto debito automatico" do Inter).
UPDATE fin_transactions SET category = 'Transferências', excluded = 1, confidence = 'Alta'
 WHERE account_type = 'CREDIT' AND amount_cents > 0 AND excluded = 0 AND confidence <> 'Manual'
   AND (upper(description) LIKE '%PAGTO%' OR upper(description) LIKE '%PAGAMENTO%');

-- Pagamento da fatura visto da conta corrente ("Pagamento efetuado - Fatura cartão").
UPDATE fin_transactions SET category = 'Transferências', excluded = 1, confidence = 'Alta'
 WHERE excluded = 0 AND confidence <> 'Manual'
   AND (upper(description) LIKE '%FATURA CART%' OR upper(description) LIKE '%PAGAMENTO FAT%');

-- Pagamento de fatura com texto genérico na conta corrente: mesmo valor pago num cartão da família em até 3 dias.
UPDATE fin_transactions SET category = 'Transferências', excluded = 1, confidence = 'Alta'
 WHERE COALESCE(account_type, '') <> 'CREDIT' AND amount_cents < 0 AND excluded = 0 AND confidence <> 'Manual'
   AND EXISTS (SELECT 1 FROM fin_transactions c
                WHERE c.household_id = fin_transactions.household_id AND c.account_type = 'CREDIT' AND c.excluded = 1
                  AND c.category = 'Transferências' AND c.amount_cents = -fin_transactions.amount_cents
                  AND abs(julianday(c.date) - julianday(fin_transactions.date)) <= 3);

-- Cartões no mês da fatura: vencimento da fatura ligada; senão a fatura prevista; senão o mês da compra.
UPDATE fin_transactions SET reference_month = COALESCE(
    (SELECT substr(b.due_date, 1, 7) FROM fin_bills b WHERE b.id = fin_transactions.bill_id),
    substr(bill_forecast_date, 1, 7),
    substr(date, 1, 7))
 WHERE account_type = 'CREDIT' AND reference_month_manual = 0;
