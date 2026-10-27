import { test, expect, type Browser, type Page } from '@playwright/test'
import { accountingCompany, cleanupAccountingCompany, api, DATE, db, payThroughForm, choose } from './accounting-helpers'
import { login } from './helpers'

test.setTimeout(240_000)
test.afterEach(cleanupAccountingCompany)
test.afterAll(async () => { await db.$disconnect() })
type Kind = 'ar' | 'ap'
async function fixture(page: Page, browser: Browser, kind: Kind, total: number) {
  page.setDefaultTimeout(30_000)
  const { orgId, vendor, customer } = await accountingCompany(page)
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@demo.com' } })
  const membership = await db.userOrganization.findUniqueOrThrow({ where: { userId_organizationId: { userId: admin.id, organizationId: orgId } } })
  const reviewer = await db.user.create({ data: { email: `reviewer-${orgId}@test.local`, fullName: 'Settlement reviewer', passwordHash: admin.passwordHash, status: 'ACTIVE' } })
  await db.userOrganization.create({ data: { userId: reviewer.id, organizationId: orgId, roleId: membership.roleId } })
  // Fixture policy: require a second person, including for administrators.
  await db.organization.update({ where: { id: orgId }, data: { approvalRequirements: { [`${kind}_payments`]: true }, requireDistinctApproverForAdmins: true } })
  const control = await db.account.findFirstOrThrow({ where: { organizationId: orgId, name: kind === 'ar' ? 'Accounts Receivable' : 'Accounts Payable', isPostable: true } })
  const expense = await db.account.findFirstOrThrow({ where: { organizationId: orgId, name: 'Cost of Goods Sold', isPostable: true } })
  const doc = kind === 'ar'
    ? await api(page, '/invoices', { customerId: customer.id, issueDate: DATE, tax: { enabled: false, inclusive: false, rate: 0 }, lines: [{ description: 'Service', quantity: 1, price: total }] }, 'POST')
    : await api(page, '/bills', { vendorId: vendor.id, vendorInvoiceNo: 'SETTLEMENT-ACCEPTANCE', issueDate: DATE, status: 'OPEN', taxable: false, subtotal: total, totalAmount: total,
      lines: [{ accountId: expense.id, description: 'Service', quantity: 1, price: total, lineTotal: total }] }, 'POST')
  if (kind === 'ar') await api(page, `/invoices/${doc.id}`, { status: 'SENT' }, 'PUT')
  const reviewerContext = await browser.newContext({ baseURL: 'http://localhost:5273' })
  const reviewerPage = await reviewerContext.newPage()
  reviewerPage.setDefaultTimeout(30_000)
  try {
    await login(reviewerPage, reviewer.email, 'admin123')
    await reviewerPage.goto(`/?org=${orgId}`)
    await reviewerPage.waitForFunction(id => sessionStorage.getItem('msm-active-org') === id, orgId)
    await reviewerContext.setExtraHTTPHeaders({ 'x-active-org': orgId })
    const period = await db.accountingPeriod.findFirstOrThrow({ where: { organizationId: orgId, name: '2026-09' } })
    return { orgId, kind, total, doc, number: kind === 'ar' ? doc.id : doc.number, partyName: kind === 'ar' ? customer.name : vendor.name,
      admin, reviewer, reviewerContext, reviewerPage, period, control }
  } catch (error) { await reviewerContext.close(); throw error }
}
type F = Awaited<ReturnType<typeof fixture>>
const payment = (f: F, id?: string) => f.kind === 'ar'
  ? id ? db.aRPayment.findUniqueOrThrow({ where: { id } }) : db.aRPayment.findFirstOrThrow({ where: { organizationId: f.orgId }, orderBy: { createdAt: 'desc' } })
  : id ? db.aPPayment.findUniqueOrThrow({ where: { id } }) : db.aPPayment.findFirstOrThrow({ where: { organizationId: f.orgId }, orderBy: { createdAt: 'desc' } })
async function submit(page: Page, f: F, settlement: number, discount = 0, fee = 0) {
  let onDialog!: (dialog: import('@playwright/test').Dialog) => void
  const unexpectedDialog = new Promise<never>((_, reject) => {
    onDialog = dialog => { void dialog.dismiss(); reject(new Error('Unexpected payment form alert: ' + dialog.message())) }
  })
  page.on('dialog', onDialog)
  try {
    await Promise.race([payThroughForm(page, f.kind, f.partyName, f.number, DATE, { settlement, discount, fee }), unexpectedDialog])
  } finally { page.off('dialog', onDialog) }
  const p = await payment(f)
  expect(p.status).toBe('PENDING_APPROVAL'); expect(p.journalEntryId).toBeNull()
  const request = await db.approvalRequest.findFirstOrThrow({ where: { organizationId: f.orgId, documentId: p.id, status: 'PENDING' } })
  expect(request.requestedById).toBe(f.admin.id)
  return { p, request }
}
async function act(f: F, pending: Awaited<ReturnType<typeof submit>>, action: 'approve' | 'reject', expectedStatus = 200) {
  const page = f.reviewerPage
  await page.goto('/ar/approvals')
  const row = page.getByRole('row').filter({ hasText: pending.p.number })
  await expect(row).toBeVisible()
  const response = page.waitForResponse(r => r.url().endsWith(`/approvals/${pending.request.id}/${action}`) && r.request().method() === 'POST')
  if (action === 'approve') await row.getByRole('button', { name: 'Approve', exact: true }).click()
  else {
    await row.getByRole('button', { name: 'Reject', exact: true }).click()
    await row.getByPlaceholder('Reason for rejection…').fill('Revise settlement before closing')
    await row.getByRole('button', { name: 'Confirm', exact: true }).click()
  }
  const result = await response
  expect(result.status(), await result.text()).toBe(expectedStatus)
  if (expectedStatus === 200) {
    await expect(row).not.toBeVisible()
    const reviewed = await db.approvalRequest.findUniqueOrThrow({ where: { id: pending.request.id } })
    expect(reviewed.reviewedById).toBe(f.reviewer.id)
    expect(reviewed.status).toBe(action === 'approve' ? 'APPROVED' : 'REJECTED')
  } else await expect(page.getByRole('status').filter({ hasText: 'Over-allocation' })).toBeVisible()
  return result
}
async function snapshot(f: F) {
  const where = { organizationId: f.orgId }, orderBy = { id: 'asc' as const }
  return {
    journals: await db.journalEntry.findMany({ where, orderBy, include: { lines: { orderBy } } }),
    requests: await db.approvalRequest.findMany({ where, orderBy }),
    ar: await db.aRPayment.findMany({ where, orderBy, include: { allocations: { orderBy } } }),
    ap: await db.aPPayment.findMany({ where, orderBy, include: { allocations: { orderBy } } }),
    invoices: await db.salesInvoice.findMany({ where, orderBy }), bills: await db.bill.findMany({ where, orderBy }),
  }
}
async function signedBalance(f: F, accountId: string, asOf = '2026-09-30') {
  const amounts = await db.journalLine.aggregate({ where: { accountId, entry: { organizationId: f.orgId, status: 'POSTED', date: { lte: new Date(`${asOf}T16:59:59.999Z`) } } }, _sum: { debit: true, credit: true } })
  return Math.round((Number(amounts._sum.debit) - Number(amounts._sum.credit)) * 100) / 100
}
async function check(f: F, page: Page, owing: number, paid: number, currentOwing = owing) {
  const path = f.kind === 'ar' ? 'invoices' : 'bills'
  expect(await api(page, `/${path}/${f.doc.id}/settlement`)).toMatchObject({ owing: currentOwing, paid: Math.round((f.total - currentOwing) * 100) / 100 })
  const status = (await api(page, `/${path}/${f.doc.id}`)).status
  expect(status).toBe(currentOwing === 0 ? 'PAID' : f.kind === 'ar' ? 'SENT' : 'OPEN')
  const aging = await api(page, `/reports/${f.kind}?type=aging&asOfDate=2026-09-30`)
  expect(aging.summary.netOutstanding).toBe(owing)
  expect(await signedBalance(f, f.control.id)).toBe(f.kind === 'ar' || owing === 0 ? owing : -owing)
  const reconciliation = await api(page, `/reports/control-reconciliation?kind=${f.kind}&asOfDate=2026-09-30`)
  expect(reconciliation.totals).toEqual({ glBalance: owing, subledgerBalance: owing, difference: 0 })
  expect(reconciliation.accounts.every((row: { difference: number }) => row.difference === 0)).toBe(true)
  expect(Math.round((f.total - owing) * 100) / 100).toBe(paid)
}
async function closeOrReopen(f: F, close: boolean) {
  const page = f.reviewerPage
  await page.goto('/company-setup')
  const row = page.getByRole('row').filter({ hasText: f.period.name })
  await row.getByRole('button', { name: close ? 'Close' : 'Reopen', exact: true }).click()
  const response = page.waitForResponse(r => r.url().endsWith(`/accounting-periods/${f.period.id}/${close ? 'close' : 'reopen'}`) && r.request().method() === 'POST')
  await page.getByRole('button', { name: close ? 'Close period' : 'Reopen period', exact: true }).click()
  const result = await response
  expect(result.status(), await result.text()).toBe(200)
  await expect(row.getByRole('button', { name: close ? 'Reopen' : 'Close', exact: true })).toBeVisible()
}

for (const kind of ['ar', 'ap'] as const) {
  test(`${kind.toUpperCase()} forms and distinct approver: exact discounts/fees, last cent, close refusal/reopen and later void`, async ({ page, browser }) => {
    const f = await fixture(page, browser, kind, 1000.01)
    try {
      const first = await submit(page, f, 600.25, 50.10, 10.05)
      await check(f, page, 1000.01, 0)
      const before = await snapshot(f)
      const selfApproval = await page.request.post(`http://localhost:3100/api/v1/approvals/${first.request.id}/approve`, { data: {} })
      expect(selfApproval.status()).toBe(403)
      expect(await snapshot(f)).toEqual(before)
      await f.reviewerPage.goto('/company-setup')
      const row = f.reviewerPage.getByRole('row').filter({ hasText: f.period.name })
      await row.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(f.reviewerPage.getByRole('button', { name: 'Close period', exact: true })).toBeDisabled()
      const deniedClose = await f.reviewerPage.request.post(`http://localhost:3100/api/v1/accounting-periods/${f.period.id}/close`, { data: {} })
      expect(deniedClose.status()).toBe(422)
      expect(await snapshot(f)).toEqual(before)
      await act(f, first, 'approve')
      await check(f, page, 399.76, 600.25)
      const posted = await payment(f, first.p.id)
      const control = 'arAccountId' in posted ? posted.arAccountId : posted.apAccountId
      const cash = 'depositAccountId' in posted ? posted.depositAccountId : posted.cashAccountId
      expect(await signedBalance(f, control!)).toBe(kind === 'ar' ? 399.76 : -399.76)
      expect(await signedBalance(f, cash!)).toBe(kind === 'ar' ? 560.20 : -560.20)
      expect(await signedBalance(f, posted.discountAccountId!)).toBe(kind === 'ar' ? 50.10 : -50.10)
      expect(await signedBalance(f, posted.penaltyAccountId!)).toBe(kind === 'ar' ? -10.05 : 10.05)
      const second = await submit(page, f, 399.75)
      await act(f, second, 'approve')
      await check(f, page, 0.01, 1000)
      await closeOrReopen(f, true)
      // A valid final-cent form save must fail only because its date is closed.
      const beforeClosed = await snapshot(f)
      await page.goto(`/${kind}/payments/new`)
      await choose(page, kind === 'ar' ? 'Select Customer...' : 'Select vendor...', f.partyName)
      await page.locator('main input[type="date"]:visible').fill(DATE)
      await page.locator('button.invoice-tab:visible', { hasText: kind === 'ar' ? 'Invoices' : 'Bills' }).click()
      await page.getByRole('row').filter({ hasText: f.number }).getByRole('checkbox').check()
      await expect(page.getByTestId('closed-period-banner')).toBeVisible()
      const deniedPayment = page.waitForResponse(r => r.url().endsWith(`/api/v1/${kind}-payments`) && r.request().method() === 'POST')
      const alert = page.waitForEvent('dialog')
      const click = page.getByRole('button', { name: 'Save Payment', exact: true }).click()
      const response = await deniedPayment
      expect(response.status()).toBe(422)
      const dialog = await alert
      expect(dialog.message()).toContain('closed/locked')
      await dialog.dismiss(); await click
      expect(await snapshot(f)).toEqual(beforeClosed)
      await closeOrReopen(f, false)
      const last = await submit(page, f, 0.01)
      await act(f, last, 'approve')
      await check(f, page, 0, 1000.01)
      await closeOrReopen(f, true)
      await api(page, `/${kind}-payments/${first.p.id}/void`, {}, 'POST')
      await check(f, page, 0, 1000.01, 600.25)
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
      const later = await api(page, `/reports/control-reconciliation?kind=${kind}&asOfDate=${today}`)
      expect(later.totals).toEqual({ glBalance: 600.25, subledgerBalance: 600.25, difference: 0 })
      expect(await signedBalance(f, posted.discountAccountId!, today)).toBe(0)
      expect(await signedBalance(f, posted.penaltyAccountId!, today)).toBe(0)
      expect(await signedBalance(f, cash!, today)).toBe(kind === 'ar' ? 399.76 : -399.76)
    } finally { await f.reviewerContext.close() }
  })
  test(`${kind.toUpperCase()} stale approval fails without side effects, remains visible and can be rejected through the inbox`, async ({ page, browser }) => {
    const f = await fixture(page, browser, kind, 1000)
    try {
      const winner = await submit(page, f, 1000), stale = await submit(page, f, 1000)
      await check(f, page, 1000, 0)
      await act(f, winner, 'approve')
      await check(f, page, 0, 1000)
      const before = await snapshot(f)
      await act(f, stale, 'approve', 422)
      expect(await snapshot(f)).toEqual(before)
      await expect(f.reviewerPage.getByRole('row').filter({ hasText: stale.p.number })).toBeVisible()
      await act(f, stale, 'reject')
      expect((await payment(f, stale.p.id)).status).toBe('DRAFT')
      expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: stale.request.id } })).status).toBe('REJECTED')
      expect((await snapshot(f)).journals).toEqual(before.journals)
      await check(f, page, 0, 1000)
    } finally { await f.reviewerContext.close() }
  })
}
