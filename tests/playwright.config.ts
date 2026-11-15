import { defineConfig } from 'playwright/test';

/**
 * Two projects share the same specs:
 *  - headless (default): the strongest attacker signal environment
 *  - headed:             real window, needed for the human control group
 *
 * Workers=1 keeps the in-memory result store deterministic; the suite is short.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  globalSetup: './global-server.ts',
  globalTeardown: './global-server.ts',
  reporter: [['list'], ['json', { outputFile: 'results/playwright-report.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:8790',
    acceptDownloads: false,
  },
  projects: [
    { name: 'headless', use: { headless: true } },
    { name: 'headed', use: { headless: false } },
  ],
});
