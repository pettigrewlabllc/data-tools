import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';

/** Fail the test if the page ever talks to anything but itself. */
function noExternalRequests(page: Page) {
  const external: string[] = [];
  page.on('request', (r) => { const h = new URL(r.url()).hostname; if (h !== 'localhost' && h !== '127.0.0.1' && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url()); });
  return () => expect(external, 'requests that left the page').toEqual([]);
}
const loaded = (page: Page) => page.waitForFunction(() => document.querySelectorAll('.tables .file').length >= 3 && !document.querySelector('.status'), null, { timeout: 60_000 });
const finding = (page: Page, column: string) => page.locator('.finding', { has: page.locator('.head code', { hasText: new RegExp(`^${column}$`) }) });
const openFinding = async (page: Page, column: string) => { const f = finding(page, column); if (await f.getByTestId('finding-detail').count() === 0) await f.getByRole('button').first().click(); };
const settled = (page: Page) => page.waitForFunction(() => !!document.querySelector('[data-testid="unique-summary"]') && !document.querySelector('[data-testid="uniqueness"] [role="status"]'), null, { timeout: 60_000 });

async function runSample(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try the sample' }).click();
  await loaded(page);
  await page.getByRole('button', { name: 'Confirm this policy' }).click();
  await page.getByRole('button', { name: /^Confirm the \d+ proposals/ }).click();
}

test('sample: draft the policy, confirm it, see the planted findings, take an option, combine, count unique, download', async ({ page }) => {
  const check = noExternalRequests(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Try the sample' }).click();
  await loaded(page);

  // Step 1: nothing is compared until the policy is confirmed, and each line points at its sentence.
  await expect(page.locator('#s3-h')).toBeVisible();
  await expect(page.getByText('Confirm the policy in step 1 and add data in step 2.').first()).toBeVisible();
  const row = page.locator('table.lines tbody tr', { hasText: 'approximate location' });
  await expect(row).toContainText('We collect your approximate location to show you trails near you.');
  await row.hover();
  await expect(page.locator('.sentences mark')).toHaveText('We collect your approximate location to show you trails near you.');
  await page.getByRole('button', { name: 'Confirm this policy' }).click();
  await expect(page.getByText(/Policy confirmed/)).toBeVisible();

  // Step 2: a column that needs confirming is flagged, then confirmed in one go.
  await page.getByRole('button', { name: /^Confirm the \d+ proposals/ }).click();

  // Step 3: the planted findings, in four classes.
  await expect(finding(page, 'lat')).toContainText('Your notice lists only approximate location');
  await expect(finding(page, 'lat').locator('xpath=ancestor::div[contains(@class,"class")][1]')).toHaveClass(/c-contradicted/);
  await expect(finding(page, 'dob')).toContainText('No sentence in your notice mentions date of birth.');
  await expect(finding(page, 'under_13')).toContainText('Your notice says it does not collect');
  await expect(finding(page, 'diagnosis')).toContainText('No sentence in your notice mentions health information.');
  await expect(finding(page, 'email')).toContainText('Your notice lists email address: "We collect your name and email address when you create an account."');

  // Click a finding: the rule citation and the options. Choosing one recomputes it.
  await finding(page, 'lat').getByRole('button').first().click();
  const detail = finding(page, 'lat').getByTestId('finding-detail');
  await expect(detail).toContainText('Cal. Civ. Code §1798.140');
  await expect(detail).toContainText('CPRA sensitive personal information');
  await detail.getByRole('button', { name: 'Generalise' }).click();
  await expect(detail.locator('.after')).toContainText('Disclosed.');
  await detail.getByRole('button', { name: 'Undo' }).click();

  // Hashing is offered for direct identifiers only, and says what it is.
  await finding(page, 'email').getByRole('button').first().click();
  await expect(finding(page, 'email').getByTestId('finding-detail')).toContainText('Pseudonymises. It is still personal data.');
  await finding(page, 'dob').getByRole('button').first().click();
  await expect(finding(page, 'dob').getByTestId('finding-detail').getByRole('button', { name: 'Hash it' })).toHaveCount(0);

  // Step 4: a rule that fires only because the tables are put together, and uniqueness on the full data.
  const combo = page.getByTestId('combination');
  await expect(combo).toContainText('HIPAA identifier next to health data');
  await expect(combo).toContainText('Fires only in the combination');
  await settled(page);
  const summary = page.getByTestId('unique-summary');
  await expect(summary).toContainText('are unique in this dataset on these columns.');
  const before = await summary.innerText();

  // Generalise the quasi-identifiers: the share unique drops.
  for (const col of ['dob', 'zip', 'lat', 'lon']) {
    await openFinding(page, col);
    await finding(page, col).getByTestId('finding-detail').getByRole('button', { name: 'Generalise' }).click();
  }
  await expect.poll(async () => await summary.innerText(), { timeout: 30_000 }).not.toBe(before);
  const pct = (t: string) => Number(/\(([\d.]+)%\)/.exec(t)![1]);
  expect(pct(await summary.innerText())).toBeLessThan(pct(before));

  // The user's file is untouched and the policy downloads.
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download policy.yml' }).last().click()]);
  const yml = readFileSync(await dl.path(), 'utf8');
  expect(yml).toMatch(/^tool: privacydiff\nversion: /);
  expect(yml).toContain('category: user.location.imprecise');
  expect(yml).toMatch(/category: user.location.imprecise\n    status: disclosed\n    sentence: s4/);

  // Wording rule, on everything the page shows.
  const text = (await page.locator('body').innerText()).toLowerCase();
  for (const w of ['compliant', 'compliance', 'violates', 'violation', 'identifiable', 're-identified', 'illegal', 'lawful']) expect(text, w).not.toContain(w);
  check();
});

test('DDL only: pasted CREATE TABLE gives category findings with no data loaded', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Notice text').fill('We collect your email address. We may collect your phone number.');
  await page.getByRole('button', { name: 'Draft the policy' }).click();
  await page.getByRole('button', { name: 'Confirm this policy' }).click();
  await page.getByLabel('Or paste table definitions').fill('CREATE TABLE people (id BIGINT, email VARCHAR, phone VARCHAR, dob DATE, ssn VARCHAR, created_at TIMESTAMP);');
  await page.getByRole('button', { name: 'Add these tables' }).click();
  await page.getByRole('button', { name: /^Confirm the \d+ proposals/ }).click();
  await expect(finding(page, 'email')).toContainText('Your notice lists email address');
  await expect(finding(page, 'phone')).toContainText('general or hedged wording');
  await expect(finding(page, 'dob')).toContainText('No sentence in your notice mentions date of birth.');
  await expect(finding(page, 'ssn')).toContainText('No sentence in your notice mentions national ID or social security number.');
  await expect(page.getByText('Uniqueness needs data. Add files in step 2.')).toBeVisible();
});

test('AI is off by default; turning it on shows exactly the notice text that would be sent, and nothing is sent', async ({ page }) => {
  const sent: string[] = [];
  page.on('request', (r) => { if (r.method() === 'POST') sent.push(r.url()); });
  await page.goto('/');
  await expect(page.getByLabel('Let me draft with a model')).not.toBeChecked();
  await page.getByLabel('Notice text').fill('We collect your email address.');
  await page.getByLabel('Let me draft with a model').check();
  await expect(page.getByTestId('ai-notice')).toHaveText('We collect your email address.');
  expect(sent).toEqual([]);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`no serious accessibility problems and no sideways scroll, ${scheme}`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: scheme });
    await runSample(page);
    await finding(page, 'lat').getByRole('button').first().click();
    await settled(page);
    const results = await new AxeBuilder({ page }).analyze();
    const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes[0]?.target}`)).toEqual([]);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth ? [] :
      Array.from(document.querySelectorAll('body *')).filter((e) => (e as HTMLElement).scrollWidth > innerWidth || e.getBoundingClientRect().right > innerWidth + 0.5)
        .slice(-5).map((e) => `${e.tagName.toLowerCase()}.${e.className} sw=${(e as HTMLElement).scrollWidth} right=${Math.round(e.getBoundingClientRect().right)}`));
    expect(wide, 'no sideways scroll (these are the widest elements)').toEqual([]);
    await info.attach(`${scheme}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });
}
