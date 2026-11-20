-- Planejamento: cartão (limite/saldo), faturas, rendas e gastos fixos, metas.

-- Dados da conta/cartão vindos da Pluggy (atualizados a cada sincronização).
ALTER TABLE fin_accounts ADD COLUMN balance_cents INTEGER;
ALTER TABLE fin_accounts ADD COLUMN credit_limit_cents INTEGER;
ALTER TABLE fin_accounts ADD COLUMN available_limit_cents INTEGER;
ALTER TABLE fin_accounts ADD COLUMN due_date TEXT;             -- vencimento da fatura atual (AAAA-MM-DD)
ALTER TABLE fin_accounts ADD COLUMN minimum_payment_cents INTEGER;

-- Data da compra (creditCardMetadata.purchaseDate): identifica as parcelas de uma mesma compra.
ALTER TABLE fin_transactions ADD COLUMN purchase_date TEXT;

CREATE TABLE fin_bills (
  id             TEXT PRIMARY KEY,         -- id da fatura na Pluggy
  account_id     TEXT NOT NULL REFERENCES fin_accounts(id) ON DELETE CASCADE,
  household_id   TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  due_date       TEXT NOT NULL,            -- AAAA-MM-DD
  closing_date   TEXT,
  total_cents    INTEGER NOT NULL,         -- valor a pagar (positivo)
  minimum_cents  INTEGER,
  updated_at     TEXT NOT NULL
);
CREATE INDEX fin_bills_account_idx ON fin_bills(account_id, due_date);

-- Rendas e gastos fixos planejados. Privados por padrão; "family" entra na projeção da família.
CREATE TABLE plan_entries (
  id            TEXT PRIMARY KEY,
  household_id  TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
  name          TEXT NOT NULL,
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  frequency     TEXT NOT NULL CHECK (frequency IN ('monthly', 'yearly', 'once')),
  month_of_year INTEGER CHECK (month_of_year BETWEEN 1 AND 12),   -- anual: em que mês cai (ex.: 13º = 12)
  start_month   TEXT NOT NULL,             -- AAAA-MM (para "once", é o mês do lançamento)
  end_month     TEXT,                      -- AAAA-MM inclusive; NULL = sem fim
  visibility    TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'family')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX plan_entries_household_idx ON plan_entries(household_id, visibility);
CREATE INDEX plan_entries_owner_idx ON plan_entries(owner_user_id);

-- Parâmetros da projeção da família.
CREATE TABLE plan_settings (
  household_id           TEXT PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
  commit_limit_pct       INTEGER NOT NULL DEFAULT 30,   -- teto saudável de (fixos + parcelas) / renda
  variable_override_cents INTEGER,                      -- gasto variável mensal estimado (NULL = automático)
  updated_at             TEXT NOT NULL
);

-- Metas: compras, viagens, reserva.
CREATE TABLE goals (
  id            TEXT PRIMARY KEY,
  household_id  TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('purchase', 'trip', 'reserve', 'other')),
  name          TEXT NOT NULL,
  target_cents  INTEGER NOT NULL CHECK (target_cents > 0),
  target_month  TEXT NOT NULL,             -- AAAA-MM
  visibility    TEXT NOT NULL DEFAULT 'family' CHECK (visibility IN ('private', 'family')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done', 'archived')),
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX goals_household_idx ON goals(household_id, status);

-- Aportes (quanto já foi guardado) e itens do orçamento (ex.: passagem, hotel numa viagem).
CREATE TABLE goal_contributions (
  id           TEXT PRIMARY KEY,
  goal_id      TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  user_id      TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  amount_cents INTEGER NOT NULL,           -- negativo = retirada
  date         TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX goal_contributions_goal_idx ON goal_contributions(goal_id);

CREATE TABLE goal_items (
  id           TEXT PRIMARY KEY,
  goal_id      TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  created_at   TEXT NOT NULL
);
CREATE INDEX goal_items_goal_idx ON goal_items(goal_id);
