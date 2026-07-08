import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:5055',
  },
  webServer: {
    command: 'npm run dev',
    port: 5055,
    reuseExistingServer: true,
  },
});
