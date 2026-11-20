// Gera o SQL das tabelas do Better Auth para a versão instalada.
// Uso: node scripts/gen-auth-schema.mjs > migrations/0001_auth.sql
// Os plugins aqui precisam bater com src/worker/auth.ts (os que criam tabelas/colunas).
import { DatabaseSync } from 'node:sqlite';
import { getMigrations } from 'better-auth/db/migration';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { emailOTP } from 'better-auth/plugins/email-otp';

const db = new DatabaseSync(':memory:');
const { compileMigrations } = await getMigrations({
  database: db,
  plugins: [twoFactor({ allowPasswordless: true }), emailOTP({ sendVerificationOTP: async () => {} })],
  rateLimit: { enabled: true, storage: 'database' },
});
process.stdout.write('-- Gerado por scripts/gen-auth-schema.mjs (Better Auth). Não editar à mão.\n');
process.stdout.write((await compileMigrations()).trim() + '\n');
