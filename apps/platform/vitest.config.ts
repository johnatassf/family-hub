import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    plugins: [
      cloudflareTest({
        main: './src/worker/index.ts',
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          assets: undefined,
          bindings: {
            TEST_MIGRATIONS: migrations,
            APP_URL: 'http://localhost',
            BETTER_AUTH_SECRET: 'segredo-de-teste-com-tamanho-suficiente-123456',
            BOOTSTRAP_OWNER_EMAILS: 'dono@teste.local',
            DEV_EMAIL_OUTBOX: 'true',
            REQUIRE_ADMIN_2FA: 'true',
            ALLOW_OPEN_SIGNUP: 'false',
          },
        },
      }),
    ],
    test: { setupFiles: ['./test/setup.ts'] },
  };
});
