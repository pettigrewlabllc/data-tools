import { defineConfig, devices } from '@playwright/test';

// Browser tests against the production build (vite preview). Join Receipt on 3077 so a dev server on 3067 can keep running; PrivacyDiff on 3068.
const PD = '**/privacydiff.e2e.ts';
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 90_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://localhost:3077', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', testIgnore: PD, use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
    { name: 'phone', testIgnore: PD, use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
    // Safari and Firefox load a different DuckDB-Wasm build than Chrome, so they get their own runs.
    { name: 'safari', testIgnore: PD, use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 900 } } },
    { name: 'iphone', testIgnore: PD, use: { ...devices['iPhone 15'], viewport: { width: 390, height: 844 } } },
    { name: 'firefox', testIgnore: PD, use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 900 } } },
    // PrivacyDiff: its own preview server on 3068, Chrome at desktop and phone width.
    { name: 'privacydiff-desktop', testMatch: PD, use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, baseURL: 'http://localhost:3068' } },
    { name: 'privacydiff-phone', testMatch: PD, use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, baseURL: 'http://localhost:3068' } },
  ],
  webServer: [
    {
      command: 'npm run build -w join-receipt && npm exec -w join-receipt -- vite preview --port 3077 --strictPort',
      url: 'http://localhost:3077',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'npm run build -w privacydiff && npm exec -w privacydiff -- vite preview --port 3068 --strictPort',
      url: 'http://localhost:3068',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
