import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';

const XLSX = readFileSync(new URL('../packages/core/test/data/laus_style.xlsx', import.meta.url));

/** Fail the test if the page ever talks to anything but itself. */
function noExternalRequests(page: Page) {
  const external: string[] = [];
  page.on('request', (r) => { const h = new URL(r.url()).hostname; if (h !== 'localhost' && h !== '127.0.0.1') external.push(r.url()); });
  return () => expect(external, 'requests that left the page').toEqual([]);
}
const settled = (page: Page, cards: number) =>
  page.waitForFunction((n) => document.querySelectorAll('.card .paper').length >= n && !document.querySelector('[aria-busy="true"]'), cards, { timeout: 60_000 });
const card = (page: Page, text: string) => page.locator('.card', { has: page.locator('.on', { hasText: text }) });

test('sample data: receipts, the Alaska pattern, fan-out fixed by a roll-up, and the export matches', async ({ page }) => {
  const check = noExternalRequests(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Try the sample data' }).click();
  await settled(page, 3);

  const ak = card(page, 'counties.csv.fips = unemployment_2024.csv.county_fips');
  await expect(ak.locator('.paper')).toContainText('208 of 216 counties.csv rows');
  await expect(ak.locator('.paper')).toContainText('All 8 unmatched rows have state = AK');
  await expect(ak.locator('.paper')).toContainText('Zero-padding to 5 took the match rate from 81.9% to 96.3%.');

  const daily = card(page, 'counties.csv.fips = store_visits_daily.csv.county_fips');
  await expect(daily.locator('.fanout')).toContainText('This join multiplies rows.');
  await daily.getByRole('button', { name: /^Roll store_visits_daily\.csv up/ }).click();
  await settled(page, 3);
  await expect(daily.locator('.fanout')).toHaveCount(0);
  await expect(daily.locator('.paper')).toContainText('Rolled up');

  await ak.getByRole('button', { name: 'Approve' }).click();
  await expect(ak).toContainText('Approved. It goes in your downloads.');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /^Joined data:/ }).click()]);
  const rows = readFileSync(await dl.path(), 'utf8').trim().split('\n');
  expect(rows.length - 1).toBe(216);
  await expect(page.locator('.code pre')).toContainText('assert len(');
  check();
});

test('an edit sends an approved join back for approval', async ({ page }) => {
  await page.goto('/?sample=1');
  await settled(page, 3);
  const ak = card(page, 'counties.csv.fips = unemployment_2024.csv.county_fips');
  await ak.getByRole('button', { name: 'Approve' }).click();
  await ak.locator('details.edit summary').click();
  await ak.getByRole('button', { name: /^Remove zero-pad/ }).click();
  await settled(page, 3);
  await expect(ak.getByRole('button', { name: 'Approve' })).toBeVisible();
  await expect(ak.locator('.paper')).toContainText('177 of 216');
});

test('Excel plus CSV: two-column key proposed, CSV copy offered with the scripts', async ({ page }) => {
  const check = noExternalRequests(page);
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles([
    { name: 'counties.csv', mimeType: 'text/csv', buffer: Buffer.from('state_fips,county_fips,name\n01,001,Autauga\n01,003,Baldwin\n06,001,Alameda\n06,037,Los Angeles\n48,201,Harris\n48,001,Anderson\n') },
    { name: 'laus_style.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: XLSX },
  ]);
  await settled(page, 1);
  await expect(page.locator('.file', { hasText: 'laus_style.xlsx' })).toContainText('From sheet "Data", header on row 4');
  const c = page.locator('.card').first();
  await expect(c.locator('.on')).toContainText('and');
  await expect(c.locator('.paper')).toContainText('5 of 6 counties.csv rows');
  await c.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('button', { name: 'laus_style.xlsx.csv' })).toBeVisible();
  check();
});

test('bad files fail with a reason and the rest still load', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles([
    { name: 'empty.csv', mimeType: 'text/csv', buffer: Buffer.from('') },
    { name: 'ragged.csv', mimeType: 'text/csv', buffer: Buffer.from('id,v\n1,2\n2\n3,4,5\n') },
    { name: 'short.csv', mimeType: 'text/csv', buffer: Buffer.from('id,v\n1,2\n2\n3,4\n') },
    { name: 'ok.csv', mimeType: 'text/csv', buffer: Buffer.from('id,w\n1,9\n2,8\n3,7\n') },
  ]);
  const errors = page.getByRole('alert').filter({ hasText: "didn't load" });
  await expect(errors).toContainText('empty.csv');
  await expect(errors).toContainText('the file is empty');
  await expect(errors).toContainText('ragged.csv');
  await expect(errors).toContainText('but the header has 2');
  await expect(page.locator('.file', { hasText: 'short.csv' }).getByRole('note')).toContainText('Line 3 has 1 field');
  await settled(page, 1);
});

test('keyboard only: the sample loads from Enter', async ({ page, browserName }) => {
  await page.goto('/');
  // Safari on a Mac skips buttons on Tab unless the user turns that on; Option+Tab is its keyboard path.
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(page.getByRole('button', { name: 'Try the sample data' })).toBeFocused();
  await page.keyboard.press('Enter');
  await settled(page, 3);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`no serious accessibility problems, ${scheme}`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/?sample=1');
    await settled(page, 3);
    await page.locator('.card details.edit summary').first().click();
    const results = await new AxeBuilder({ page }).analyze();
    const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes[0]?.target}`)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll').toBe(true);
    await info.attach(`${scheme}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });
}
