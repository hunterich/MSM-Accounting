import { test, expect } from '@playwright/test'
import { accountingCompany, cleanupAccountingCompany, api, db } from './accounting-helpers'

test.afterEach(cleanupAccountingCompany)
test.afterAll(async () => { await db.$disconnect() })

test('reconciles a transfer on both statements and can unmatch just one side', async ({ page }) => {
  const { orgId } = await accountingCompany(page)
  const source = await db.bankAccount.create({ data: { organizationId: orgId, name: 'Marketplace wallet' } })
  const destination = await db.bankAccount.create({ data: { organizationId: orgId, name: 'Payout bank' } })
  const date = new Date('2026-09-15T00:00:00Z')
  const transfer = await db.bankTransaction.create({ data: { organizationId: orgId, bankAccountId: source.id, toBankAccountId: destination.id,
    date, amount: 1000, type: 'TRANSFER', description: 'Marketplace payout' } })
  const walletStatement = await db.bankStatement.create({ data: { organizationId: orgId, bankAccountId: source.id, filename: 'wallet.csv',
    lines: { create: [{ date, amount: -1000, description: 'Wallet payout' }] } }, include: { lines: true } })
  const bankStatement = await db.bankStatement.create({ data: { organizationId: orgId, bankAccountId: destination.id, filename: 'payout-bank.csv',
    lines: { create: [{ date, amount: 1000, description: 'Bank payout' }] } }, include: { lines: true } })
  expect((await api(page, `/bank-statements/match?statementId=${walletStatement.id}`, {}, 'POST')).matched).toBe(1)
  await page.goto('/banking/reconciliation')
  await page.locator('select').filter({ has: page.locator('option', { hasText: 'payout-bank.csv' }) }).selectOption(bankStatement.id)
  await expect(page.getByText('Bank payout', { exact: true })).toBeVisible()
  const saved = page.waitForResponse(r => r.url().endsWith(`/bank-statements/${bankStatement.lines[0].id}`) && r.request().method() === 'PUT')
  const control = page.locator('div.cursor-pointer:visible', { hasText: 'Match to transaction...' }).first()
  await control.click()
  await control.locator('xpath=following-sibling::div[1]').locator('div.cursor-pointer', { hasText: 'Marketplace payout' }).first().click()
  expect((await saved).ok()).toBeTruthy()
  await expect.poll(async () => (await db.bankStatementLine.findUniqueOrThrow({ where: { id: bankStatement.lines[0].id } })).matchedTxId).toBe(transfer.id)
  await page.getByRole('button', { name: 'Unmatch', exact: true }).click()
  await expect.poll(async () => (await db.bankStatementLine.findUniqueOrThrow({ where: { id: bankStatement.lines[0].id } })).matchedTxId).toBeNull()
  expect((await db.bankStatementLine.findUniqueOrThrow({ where: { id: walletStatement.lines[0].id } })).matchedTxId).toBe(transfer.id)
  expect((await db.bankTransaction.findUniqueOrThrow({ where: { id: transfer.id } })).status).toBe('MATCHED')
})
