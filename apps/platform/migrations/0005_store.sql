-- Módulo Empresa: loja de presentes (revenda Natura/Boticário/Avon/Jequiti + kits montados).
-- Os dados da empresa são privados: só os membros da empresa veem (nem a família por padrão).

CREATE TABLE biz_businesses (
  id            TEXT PRIMARY KEY,
  household_id  TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'gift_shop',
  created_at    TEXT NOT NULL
);
CREATE INDEX biz_businesses_household_idx ON biz_businesses(household_id);

CREATE TABLE biz_members (
  business_id TEXT NOT NULL REFERENCES biz_businesses(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at  TEXT NOT NULL,
  PRIMARY KEY (business_id, user_id)
);
CREATE INDEX biz_members_user_idx ON biz_members(user_id);

-- Produto de revenda, kit/cesta montado, ou insumo (caixa, laço, papel, cesta).
CREATE TABLE biz_products (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES biz_businesses(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('product', 'kit', 'supply')),
  name        TEXT NOT NULL,
  brand       TEXT,
  category    TEXT,
  sku         TEXT,
  cost_cents  INTEGER,                 -- custo unitário (kit: calculado pelos componentes)
  price_cents INTEGER,                 -- preço de venda
  stock_qty   INTEGER,                 -- NULL = não controla estoque (kits nunca têm estoque próprio)
  min_stock   INTEGER,
  active      INTEGER NOT NULL DEFAULT 1,
  notes       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX biz_products_business_idx ON biz_products(business_id, kind, name);

CREATE TABLE biz_kit_items (
  kit_id       TEXT NOT NULL REFERENCES biz_products(id) ON DELETE CASCADE,
  component_id TEXT NOT NULL REFERENCES biz_products(id) ON DELETE CASCADE,
  qty          INTEGER NOT NULL CHECK (qty > 0),
  PRIMARY KEY (kit_id, component_id)
);

CREATE TABLE biz_customers (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES biz_businesses(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  phone       TEXT,
  birthday    TEXT,                    -- MM-DD
  notes       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX biz_customers_business_idx ON biz_customers(business_id, name);

CREATE TABLE biz_sales (
  id             TEXT PRIMARY KEY,
  business_id    TEXT NOT NULL REFERENCES biz_businesses(id) ON DELETE CASCADE,
  customer_id    TEXT REFERENCES biz_customers(id) ON DELETE SET NULL,
  date           TEXT NOT NULL,        -- AAAA-MM-DD
  subtotal_cents INTEGER NOT NULL,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  total_cents    INTEGER NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('dinheiro', 'pix', 'debito', 'credito', 'fiado', 'outro')),
  status         TEXT NOT NULL CHECK (status IN ('paid', 'open', 'canceled')),
  due_date       TEXT,                 -- fiado: data combinada para pagar
  notes          TEXT,
  created_by     TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX biz_sales_business_date_idx ON biz_sales(business_id, date);
CREATE INDEX biz_sales_customer_idx ON biz_sales(customer_id);

CREATE TABLE biz_sale_items (
  id               TEXT PRIMARY KEY,
  sale_id          TEXT NOT NULL REFERENCES biz_sales(id) ON DELETE CASCADE,
  product_id       TEXT REFERENCES biz_products(id) ON DELETE SET NULL,
  description      TEXT NOT NULL,
  qty              INTEGER NOT NULL CHECK (qty > 0),
  unit_price_cents INTEGER NOT NULL,
  unit_cost_cents  INTEGER,            -- custo no momento da venda (para o lucro)
  total_cents      INTEGER NOT NULL
);
CREATE INDEX biz_sale_items_sale_idx ON biz_sale_items(sale_id);
CREATE INDEX biz_sale_items_product_idx ON biz_sale_items(product_id);

CREATE TABLE biz_payments (
  id           TEXT PRIMARY KEY,
  sale_id      TEXT NOT NULL REFERENCES biz_sales(id) ON DELETE CASCADE,
  date         TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  method       TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX biz_payments_sale_idx ON biz_payments(sale_id);

-- Histórico de estoque: venda, cancelamento, entrada de mercadoria, ajuste.
CREATE TABLE biz_stock_moves (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES biz_businesses(id) ON DELETE CASCADE,
  product_id  TEXT NOT NULL REFERENCES biz_products(id) ON DELETE CASCADE,
  qty_delta   INTEGER NOT NULL,
  reason      TEXT NOT NULL CHECK (reason IN ('sale', 'cancel', 'purchase', 'adjust')),
  ref_id      TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX biz_stock_moves_product_idx ON biz_stock_moves(product_id, created_at);

-- Boletos e contas da loja (pedidos às marcas etc.). "Compartilhado" = dividido com outra pessoa.
CREATE TABLE biz_payables (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL REFERENCES biz_businesses(id) ON DELETE CASCADE,
  supplier     TEXT NOT NULL,
  description  TEXT,
  due_date     TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  status       TEXT NOT NULL CHECK (status IN ('open', 'paid')),
  paid_cents   INTEGER,
  paid_date    TEXT,
  shared       INTEGER NOT NULL DEFAULT 0,
  notes        TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX biz_payables_business_due_idx ON biz_payables(business_id, status, due_date);
