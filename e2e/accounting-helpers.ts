import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { expect, type Page } from '@playwright/test'
import { bootstrapOrganization } from '../lib/organization/bootstrap'
import { login } from './helpers'

// Same disposable sibling database as playwright.config.ts. Never use the
// ambient Prisma client: it could resolve DATABASE_URL to the working database.
const base = process.env.DATABASE_URL ?? readFileSync('.env', 'utf8')
  .match(/^\s*DATABASE_URL\s*=\s*"?([^"\n]+)"?/m)?.[1]
if (!base) throw new Error('DATABASE_URL is required for accounting browser tests')
const url = new URL(base)
const name = url.pathname.slice(1)
url.pathname = `/${name.endsWith('_e2e') ? name : `${name}_e2e`}`
if (!url.pathname.endsWith('_e2e')) throw new Error('Accounting tests require an _e2e database')
export const db = new PrismaClient({ datasources: { db: { url: url.toString() } } })
export const DATE = '2026-09-15'
let createdOrgId: string | undefined

export async function cleanupAccountingCompany() {
  if (!createdOrgId) return
  const orgId = createdOrgId
  createdOrgId = undefined
  // Remove the test membership even if a failed journey leaves linked rows.
  // Otherwise later specs signing in as the demo admin inherit extra companies.
  await db.userOrganization.deleteMany({ where: { organizationId: orgId } })
  // Keep transaction evidence for debugging in the disposable database.
  // Database setup removes it before the next complete test run.
}

export async function accountingCompany(page: Page) {
  page.on('pageerror', error => console.error(`Application error: ${error.message}`))
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@demo.com' } })
  const { orgId } = await db.$transaction(tx => bootstrapOrganization(tx, {
    legalName: `ZZ Accounting E2E ${randomUUID()}`, displayName: 'Accounting test company',
    fiscalYearStart: new Date('2026-01-01'),
  }, admin.id))
  createdOrgId = orgId
  await db.organization.update({ where: { id: orgId }, data: { costingMethod: 'FIFO' } })
  const vendor = await db.vendor.create({ data: { organizationId: orgId, code: 'V-1', name: 'Journey Supplier' } })
  const customer = await db.customer.create({ data: { organizationId: orgId, code: 'C-1', name: 'Journey Customer' } })
  const item = await db.item.create({ data: {
    organizationId: orgId, sku: 'JOURNEY-1', name: 'Journey Widget', costPrice: 1000, sellingPrice: 2000,
  } })
  // The JWT carries the membership snapshot: sign in after adding this company.
  await login(page)
  await page.goto(`/?org=${orgId}`)
  await page.waitForFunction(id => sessionStorage.getItem('msm-active-org') === id, orgId)
  await expect(page.locator('nav')).toBeVisible()
  await page.context().setExtraHTTPHeaders({ 'x-active-org': orgId })
  return { orgId, vendor, customer, item }
}

export async function choose(page: Page, placeholder: string, label: string) {
  const control = page.locator('div.cursor-pointer:visible', { hasText: placeholder }).first()
  await control.click()
  await control.locator('xpath=following-sibling::div[1]')
    .locator('div.cursor-pointer', { hasText: label }).first().click()
}

export async function api(page: Page, path: string, data?: unknown, method = 'GET') {
  const orgId = await page.evaluate(() => sessionStorage.getItem('msm-active-org'))
  const response = await page.request.fetch(`http://localhost:3100/api/v1${path}`, {
    method, headers: { 'x-active-org': orgId! }, ...(data !== undefined ? { data } : {}),
  })
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy()
  const body = await response.json()
  return body.data ?? body
}

export async function expectJournal(orgId: string, entryId: string, expected: Array<[string, number, number]>) {
  const entry = await db.journalEntry.findFirstOrThrow({
    where: { id: entryId, organizationId: orgId }, include: { lines: { include: { account: true } } },
  })
  expect(entry.status).toBe('POSTED')
  expect(entry.lines.map(l => [l.account.code, Number(l.debit), Number(l.credit)])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]))))
    .toEqual([...expected].sort((a, b) => a[0].localeCompare(b[0])))
  expect(entry.lines.reduce((s, l) => s + Number(l.debit), 0))
    .toBeCloseTo(entry.lines.reduce((s, l) => s + Number(l.credit), 0), 2)
}

export async function expectTrialBalance(page: Page, expected: Array<[string, number, number]>) {
  const report = await api(page, `/reports/gl?type=trial-balance&asOfDate=${DATE}`)
  expect(report.rows.map((r: { accountCode: string; endingDebit: number; endingCredit: number }) =>
    [r.accountCode, r.endingDebit, r.endingCredit]).sort((a: unknown[], b: unknown[]) =>
    String(a[0]).localeCompare(String(b[0]))))
    .toEqual([...expected].sort((a, b) => a[0].localeCompare(b[0])))
  expect(report.summary.endingDebit).toBeCloseTo(report.summary.endingCredit, 2)
}

export async function payThroughForm(page: Page, kind: 'ap' | 'ar', party: string, number: string, date = DATE) {
  await page.goto(`/${kind}/payments/new`)
  await choose(page, kind === 'ap' ? 'Select vendor...' : 'Select Customer...', party)
  await page.locator('main input[type="date"]:visible').fill(date)
  await page.locator('button.invoice-tab:visible', { hasText: kind === 'ap' ? 'Bills' : 'Invoices' }).click()
  await page.getByRole('row').filter({ hasText: number }).getByRole('checkbox').check()
  const saved = page.waitForResponse(r => r.url().endsWith(`/api/v1/${kind}-payments`) && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'Save Payment', exact: true }).click()
  const response = await saved
  expect(response.ok(), await response.text()).toBeTruthy()
  await page.waitForURL(url => url.pathname === `/${kind}/payments`)
}
