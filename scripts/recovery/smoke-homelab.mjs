import { chromium } from '@playwright/test';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const root = 'artifacts/recovery-drill/20261008-windows';
const credentials = JSON.parse(fs.readFileSync(`${root}/qa-login.json`, 'utf8'));
const browser = await chromium.launch();
const context = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: 'https://192.168.68.102:8446' });
const page = await context.newPage();
const results = { checkedAt: new Date().toISOString(), checks: [], failures: [] };
try {
  const response = await page.goto('/login');
  assert.equal(response.status(), 200);
  assert.equal(response.headers()['x-content-type-options'], 'nosniff');
  assert.ok(response.headers()['content-security-policy']);
  await page.locator('input[type=email]').fill(credentials.email);
  await page.locator('input[type=password]').fill(credentials.password);
  const loginPromise = page.waitForResponse(r => r.url().includes('/auth/login') && r.request().method() === 'POST');
  await page.locator('button[type=submit]').click();
  const login = await loginPromise;
  assert.equal(login.status(), 200);
  const session = await login.json();
  const cookies = await context.cookies();
  assert.ok(cookies.some(c => c.name === 'msm_token' && c.httpOnly && c.secure));
  results.checks.push({ name: 'HTTPS browser login and secure session cookie', passed: true });
  const memberships = session.memberships;
  assert.ok(memberships.length > 0);
  await page.getByText(memberships[0].name, { exact: true }).click();
  await page.waitForTimeout(1000);
  for (const membership of memberships) {
    const headers = { 'x-active-org': membership.orgId };
    for (const path of [
      'invoices', 'bills', 'ar-payments', 'ap-payments', 'journal-entries', 'items',
      'reports/gl?type=trial-balance&asOfDate=2026-10-08',
      'reports/gl?type=balance-sheet&asOfDate=2026-10-08',
      'reports/gl?type=profit-loss&dateFrom=2000-01-01&dateTo=2026-10-08',
      'reports/ar?type=aging&asOfDate=2026-10-08',
      'reports/ap?type=aging&asOfDate=2026-10-08',
    ]) {
      const r = await context.request.get(`/api/v1/${path}`, { headers });
      const data = await r.json();
      const check = { name: path, orgId: membership.orgId, status: r.status(), passed: r.ok() };
      if (!r.ok()) check.error = data.error;
      if (path.includes('trial-balance')) {
        check.summary = data.summary ?? data.data?.summary;
        const originalPath = `${root}/trial-balance.json`;
        if (fs.existsSync(originalPath)) {
          const original = JSON.parse(fs.readFileSync(originalPath, 'utf8'));
          const net = value => Object.fromEntries(value.rows
            .filter(row => row.endingDebit || row.endingCredit)
            .map(row => [row.accountId, [row.endingDebit, row.endingCredit]]));
          assert.deepEqual(net(data), net(original));
          results.checks.push({ name: 'All account net balances match pre-write baseline', passed: true });
          fs.writeFileSync(`${root}/trial-balance-after.json`, JSON.stringify(data, null, 2));
        } else fs.writeFileSync(originalPath, JSON.stringify(data, null, 2));
      }
      results.checks.push(check);
      if (!r.ok()) results.failures.push(check);
      if (['invoices', 'bills'].includes(path) && r.ok()) {
        const rows = Array.isArray(data) ? data : data.data ?? data.items ?? data.invoices ?? data.bills;
        if (Array.isArray(rows) && rows[0]?.id) {
          const detail = await context.request.get(`/api/v1/${path}/${rows[0].id}`, { headers });
          results.checks.push({ name: `${path} existing document detail`, passed: detail.ok(), status: detail.status() });
          assert.ok(detail.ok());
        }
      }
    }
  }
  const blocked = await context.request.get('/api/v1/invoices', { headers: { 'x-active-org': 'not-a-member' } });
  assert.equal(blocked.status(), 403);
  results.checks.push({ name: 'Unrelated company access rejected', passed: true });
  for (const route of ['/ar/invoices', '/ap/bills', '/gl/journals', '/reports']) {
    await page.goto(route);
    await page.waitForTimeout(1500);
    assert.ok(!page.url().includes('/login'));
    assert.equal(await page.getByText('Choose a company', { exact: true }).count(), 0);
    assert.ok(await page.locator('main').count());
    await page.screenshot({ path: `${root}/${route.replaceAll('/', '_')}.png`, fullPage: true });
    results.checks.push({ name: `Browser ${route}`, passed: true });
  }
} catch (e) {
  results.failures.push({ error: e.message });
} finally {
  await browser.close();
  fs.writeFileSync(`${root}/application-verification.json`, JSON.stringify(results, null, 2));
}
console.log(JSON.stringify(results, null, 2));
if (results.failures.length) process.exitCode = 1;
