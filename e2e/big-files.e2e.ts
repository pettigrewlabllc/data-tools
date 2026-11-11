import { test, expect } from '@playwright/test';

// Opt-in: JR_BIG=<dir with customers.csv and orders.csv> npx playwright test e2e/big-files.e2e.ts
// Measures drop-to-receipt time on large files in each browser. Too slow and too big for CI.
const dir = process.env.JR_BIG;
test.skip(!dir, 'set JR_BIG to a folder with customers.csv and orders.csv');
test.setTimeout(300_000);

test('large files reach a receipt', async ({ page, browserName }, info) => {
  await page.goto('/');
  const t0 = Date.now();
  await page.setInputFiles('input[type=file]', [`${dir}/customers.csv`, `${dir}/orders.csv`]);
  await page.waitForFunction(() => document.querySelector('.card .paper') && !document.querySelector('[aria-busy="true"]'), null, { timeout: 280_000 });
  const secs = (Date.now() - t0) / 1000;
  await expect(page.locator('.errors')).toHaveCount(0);
  console.log(`BIG ${browserName}/${info.project.name}: ${secs.toFixed(1)}s`);
});
