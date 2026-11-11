import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      main: './src/index.ts',
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(
            join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
          ),
          JWT_SECRET: 'test-jwt-secret-that-is-at-least-thirty-two-bytes',
          DATA_ENCRYPTION_KEY: btoa('t'.repeat(32)),
          INTERNAL_SECRET: 'test-internal-secret-at-least-thirty-two-bytes',
          ALLOWED_ORIGINS: 'https://app.test,tauri://localhost,https://tauri.localhost',
          WEB_URL: 'https://app.test',
          EMAIL_FROM: 'NEXA <test@example.com>',
          HIBP_ENABLED: 'false',
        },
      },
    })),
  ],
  test: {
    setupFiles: ['./test/setup.ts'],
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/lib/**/*.ts'],
      thresholds: { branches: 75, functions: 80, lines: 80, statements: 80 },
    },
  },
});
