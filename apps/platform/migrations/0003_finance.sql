-- Módulo financeiro. Toda linha carrega household_id; o dono é quem conectou a conta.

-- Conexão Pluggy (itemId). Um item só pode ter um dono em toda a plataforma.
CREATE TABLE fin_items (
  id                   TEXT PRIMARY KEY,
  household_id         TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  owner_user_id        TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  pluggy_item_id       TEXT NOT NULL UNIQUE,
  connector_name       TEXT,
  status               TEXT,
  last_sync_at         TEXT,
  last_sync_started_at TEXT,             -- trava: no máximo 1 sincronização a cada 5 min
  last_error           TEXT,
  created_at           TEXT NOT NULL
);
CREATE INDEX fin_items_household_idx ON fin_items(household_id);
CREATE INDEX fin_items_owner_idx ON fin_items(owner_user_id);

-- Conta/cartão. Nasce privada; o dono decide compartilhar com a família.
CREATE TABLE fin_accounts (
  id            TEXT PRIMARY KEY,        -- id da conta na Pluggy
  item_id       TEXT NOT NULL REFERENCES fin_items(id) ON DELETE CASCADE,
  household_id  TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  type          TEXT,                    -- BANK | CREDIT
  subtype       TEXT,                    -- CHECKING_ACCOUNT | CREDIT_CARD ...
  name          TEXT,
  number        TEXT,
  nickname      TEXT,
  visibility    TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'family')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX fin_accounts_household_idx ON fin_accounts(household_id, visibility);
CREATE INDEX fin_accounts_owner_idx ON fin_accounts(owner_user_id);

CREATE TABLE fin_transactions (
  id                 TEXT PRIMARY KEY,   -- id da transação na Pluggy
  account_id         TEXT NOT NULL REFERENCES fin_accounts(id) ON DELETE CASCADE,
  household_id       TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  description        TEXT NOT NULL,
  amount_cents       INTEGER NOT NULL,   -- centavos, sinal da Pluggy (despesa < 0)
  date               TEXT NOT NULL,      -- AAAA-MM-DD
  reference_month    TEXT NOT NULL,      -- AAAA-MM (editável)
  account_type       TEXT,
  category           TEXT NOT NULL,
  installment        TEXT NOT NULL DEFAULT '',
  excluded           INTEGER NOT NULL DEFAULT 0,
  confidence         TEXT NOT NULL,      -- Alta | Baixa | Manual
  status             TEXT,
  bill_id            TEXT,
  bill_forecast_date TEXT,
  card_last4         TEXT,
  -- Quem fez o gasto (cartão usado por várias pessoas). NULL = o dono da conta.
  assigned_user_id   TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX fin_tx_account_date_idx ON fin_transactions(account_id, date);
CREATE INDEX fin_tx_household_month_idx ON fin_transactions(household_id, reference_month);

CREATE TABLE fin_categories (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (household_id, name)
);

CREATE TABLE fin_category_rules (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  pattern      TEXT NOT NULL,            -- normalizado (maiúsculo, sem acento)
  category     TEXT NOT NULL,
  priority     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);
CREATE INDEX fin_rules_household_idx ON fin_category_rules(household_id, priority);
CREATE UNIQUE INDEX fin_rules_pattern_uq ON fin_category_rules(household_id, pattern);

CREATE TABLE fin_sync_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id      TEXT NOT NULL REFERENCES fin_items(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL,
  trigger      TEXT NOT NULL,            -- manual | cron
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  status       TEXT NOT NULL,            -- running | ok | error
  processed    INTEGER NOT NULL DEFAULT 0,
  error        TEXT
);
CREATE INDEX fin_sync_runs_item_idx ON fin_sync_runs(item_id, started_at);
