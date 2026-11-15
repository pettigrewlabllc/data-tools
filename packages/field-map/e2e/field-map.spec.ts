import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** Fails the test if the page asks anything of another origin. With the model off, nothing should leave. */
function guardNetwork(page: Page) {
  const off: string[] = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (!['localhost', '127.0.0.1'].includes(u.hostname) && u.protocol.startsWith('http')) off.push(r.url()); });
  return off;
}

test('sample flow: a question, an answer, a passing transform, downloads', async ({ page }) => {
  const off = guardNetwork(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Try the vendor orders' }).click();
  await expect(page.getByText('9 fields. 8 confident, 1 question for you')).toBeVisible();
  await page.getByRole('button', { name: /Approve the 8 confident fields/ }).click();
  await page.getByRole('radio', { name: /^sale_price/ }).check();
  await page.locator('li', { hasText: 'Which one is price?' }).getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('24 of 24 mapped records pass the target schema.')).toBeVisible();
  const [yml] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'fieldmap.yml' }).click()]);
  expect(yml.suggestedFilename()).toBe('fieldmap.yml');
  const [js] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'transform.jsonata' }).click()]);
  expect(js.suggestedFilename()).toBe('transform.jsonata');
  expect(off).toEqual([]);
});

test('a bad file is named with the reason, and the good one still loads', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles([
    { name: 'good.json', mimeType: 'application/json', buffer: Buffer.from('[{"a":1},{"a":2},{"a":3}]') },
    { name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"a": ') },
  ]);
  await expect(page.getByText('3 records from 1 file.')).toBeVisible();
  await expect(page.locator('.errors')).toContainText('broken.json');
});

test('keyboard only: load a sample, answer a question, approve', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Safari skips buttons on Tab unless the user turns that on');
  await page.goto('/');
  await page.getByRole('button', { name: 'Try the vendor orders' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText(/9 fields/)).toBeVisible();
  await page.getByRole('radio', { name: /^list_price/ }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('radio', { name: /^list_price/ })).toBeChecked();
  await page.locator('li', { hasText: 'Which one is price?' }).getByRole('button', { name: 'Approve', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText(/mapped records pass the target schema/)).toBeVisible();
});

for (const scheme of ['light', 'dark'] as const) {
  for (const width of [1280, 390]) {
    test(`axe: no violations, ${scheme}, ${width}px`, async ({ page, browserName }) => {
      test.skip(browserName !== 'chromium', 'one engine is enough for the axe scan');
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await page.getByRole('button', { name: 'Try the vendor orders' }).click();
      await expect(page.getByText(/9 fields/)).toBeVisible();
      const r = await new AxeBuilder({ page }).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(wide).toBe(false);
      await page.screenshot({ path: `test-results/shots/${scheme}-${width}.png`, fullPage: false });
    });
  }
}
