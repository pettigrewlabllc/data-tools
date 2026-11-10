import { defineConfig, devices } from '@playwright/test';

// Browser tests against the production build (vite preview), on 3077 so a dev server on 3067 can keep running.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 90_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://localhost:3077', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
    { name: 'phone', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: 'npm run build -w join-receipt && npm exec -w join-receipt -- vite preview --port 3077 --strictPort',
    url: 'http://localhost:3077',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
