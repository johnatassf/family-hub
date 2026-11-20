-- Sincronização incremental das transações.
-- tx_synced_at: momento (relógio do app) em que começou a última busca de transações concluída para a conta.
-- NULL = conta nunca sincronizada (ou recém-aparecida na conexão) → a próxima busca traz o histórico inteiro.
ALTER TABLE fin_accounts ADD COLUMN tx_synced_at TEXT;

-- As pendentes (fatura aberta, parcelas futuras) são reconsultadas pelo id a cada sincronização.
CREATE INDEX fin_tx_pending_idx ON fin_transactions(account_id) WHERE status = 'PENDING';
