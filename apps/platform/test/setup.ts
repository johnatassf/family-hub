import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeEach } from 'vitest';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// Ordem respeita as chaves estrangeiras (filhos antes dos pais).
const TABLES = [
  'biz_payments', 'biz_sale_items', 'biz_sales', 'biz_stock_moves', 'biz_kit_items', 'biz_products', 'biz_customers', 'biz_payables', 'biz_members', 'biz_businesses',
  'goal_items', 'goal_contributions', 'goals', 'plan_settings', 'plan_entries', 'fin_bills',
  'fin_sync_runs', 'fin_transactions', 'fin_accounts', 'fin_items', 'fin_category_rules', 'fin_categories',
  'audit_log', 'invites', 'household_members', 'households',
  'twoFactor', 'session', 'account', 'verification', 'rateLimit', '"user"',
];

beforeEach(async () => {
  await env.DB.batch(TABLES.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  const { keys } = await env.KV.list();
  await Promise.all(keys.map((k) => env.KV.delete(k.name)));
});
