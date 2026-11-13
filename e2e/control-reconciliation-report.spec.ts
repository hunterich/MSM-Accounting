import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  accountingCompany,
  cleanupAccountingCompany,
  api,
  db,
} from './accounting-helpers';
import { formatIDR } from '../src/utils/formatters';
import type { ControlReconciliation } from '../lib/control-reconciliation';
test.setTimeout(180_000);
test.afterEach(cleanupAccountingCompany);
test.afterAll(() => db.$disconnect());
const day = (s: string) => new Date(s + 'T00:00:00Z');
async function fixture(page: Page, kind: 'ar' | 'ap') {
  page.setDefaultTimeout(30_000);
  const { orgId, customer, vendor } = await accountingCompany(page),
    ar = kind === 'ar';
  const primary = await db.account.findFirstOrThrow({
    where: {
      organizationId: orgId,
      name: ar ? 'Accounts Receivable' : 'Accounts Payable',
      isPostable: true,
    },
  });
  const expense = await db.account.findFirstOrThrow({
    where: {
      organizationId: orgId,
      name: 'Cost of Goods Sold',
      isPostable: true,
    },
  });
  const alternate = await db.account.create({
    data: {
      organizationId: orgId,
      code: ar ? 'QA-AR-ALT' : 'QA-AP-ALT',
      name: ar
        ? 'Accounts Receivable QA alternate'
        : 'Accounts Payable QA alternate',
      type: ar ? 'ASSET' : 'LIABILITY',
      normalSide: ar ? 'DEBIT' : 'CREDIT',
    },
  });
  const returns = await db.account.create({
    data: {
      organizationId: orgId,
      code: 'QA-RETURNS',
      name: 'QA returns',
      type: ar ? 'EXPENSE' : 'REVENUE',
      normalSide: ar ? 'DEBIT' : 'CREDIT',
    },
  });
  async function document(
    amount: number,
    date: string,
    control: string,
    reference: string,
  ) {
    if (ar) {
      const org = await db.organization.findUniqueOrThrow({
        where: { id: orgId },
      });
      await db.organization.update({
        where: { id: orgId },
        data: {
          accountDefaults: {
            ...(org.accountDefaults as Record<string, string>),
            arControl: control,
          },
        },
      });
      const invoice = await api(
        page,
        '/invoices',
        {
          customerId: customer.id,
          issueDate: date,
          tax: { enabled: false, inclusive: false, rate: 0 },
          lines: [{ description: reference, quantity: 1, price: amount }],
        },
        'POST',
      );
      await api(page, '/invoices/' + invoice.id, { status: 'SENT' }, 'PUT');
      return invoice.id as string;
    }
    const bill = await api(
      page,
      '/bills',
      {
        vendorId: vendor.id,
        vendorInvoiceNo: reference,
        issueDate: date,
        status: 'OPEN',
        taxable: false,
        subtotal: amount,
        totalAmount: amount,
        apAccountId: control,
        lines: [
          {
            accountId: expense.id,
            description: reference,
            quantity: 1,
            price: amount,
            lineTotal: amount,
          },
        ],
      },
      'POST',
    );
    return bill.id as string;
  }
  const first = await document(
    1000,
    '2026-09-10',
    primary.id,
    'Primary document',
  );
  await document(600, '2026-09-11', alternate.id, 'Alternate document');
  const cash = await db.account.findFirstOrThrow({
    where: { organizationId: orgId, code: '1-1000', isPostable: true },
  });
  for (const [amount, control, allocated] of [
    [300, primary.id, true],
    [100, alternate.id, false],
  ] as const) {
    await api(
      page,
      ar ? '/ar-payments' : '/ap-payments',
      {
        date: '2026-09-15',
        status: 'COMPLETED',
        totalAmount: amount,
        ...(ar
          ? {
              customerId: customer.id,
              arAccountId: control,
              depositAccountId: cash.id,
            }
          : {
              vendorId: vendor.id,
              apAccountId: control,
              cashAccountId: cash.id,
            }),
        allocations: allocated
          ? [
              {
                ...(ar ? { invoiceId: first } : { billId: first }),
                amountApplied: amount,
              },
            ]
          : [],
      },
      'POST',
    );
  }
  const notePath = ar ? '/credit-notes' : '/debit-notes';
  const note = await api(
    page,
    notePath,
    {
      ...(ar
        ? { customerId: customer.id, arAccountId: alternate.id }
        : { vendorId: vendor.id, apAccountId: alternate.id }),
      date: '2026-09-17',
      amount: 50,
      applyTax: false,
      taxAmount: 0,
      returnAccountId: returns.id,
    },
    'POST',
  );
  await api(page, notePath + '/' + note.id, { status: 'APPLIED' }, 'PUT');
  // Deliberately seed historical corruption only in this disposable QA company.
  // Current public manual-journal routes correctly refuse direct AR/AP offsets.
  await db.journalEntry.create({
    data: {
      organizationId: orgId,
      entryNo: 'QA-HISTORICAL',
      date: day('2026-09-25'),
      memo: 'QA historical reclass',
      source: 'MANUAL',
      status: 'POSTED',
      lines: {
        create: [
          {
            lineNo: 1,
            accountId: primary.id,
            description: 'QA historical primary',
            debit: ar ? 75 : 0,
            credit: ar ? 0 : 75,
          },
          {
            lineNo: 2,
            accountId: alternate.id,
            description: 'QA historical alternate',
            debit: ar ? 0 : 75,
            credit: ar ? 75 : 0,
          },
        ],
      },
    },
  });
  await document(300, '2026-10-05', alternate.id, 'Later document');
  return { orgId, primary, alternate };
}
async function snapshot(orgId: string) {
  return {
    journals: await db.journalEntry.findMany({
      where: { organizationId: orgId },
      orderBy: { id: 'asc' },
      include: { lines: { orderBy: { id: 'asc' } } },
    }),
    invoices: await db.salesInvoice.findMany({
      where: { organizationId: orgId },
      orderBy: { id: 'asc' },
    }),
    bills: await db.bill.findMany({
      where: { organizationId: orgId },
      orderBy: { id: 'asc' },
    }),
  };
}
async function runReport(
  page: Page,
  kind: 'ar' | 'ap',
  date: string,
  change = false,
) {
  if (!change) {
    await page.goto('/reports');
    await page
      .getByRole('button', {
        name: kind === 'ar' ? 'Receivables' : 'Payables',
        exact: true,
      })
      .click();
    await page
      .getByRole('button', {
        name: new RegExp(kind.toUpperCase() + ' Control Reconciliation'),
      })
      .click();
  } else
    await page
      .getByRole('button', { name: 'Ubah Filter', exact: true })
      .click();
  await page.getByLabel('Report as-of date', { exact: true }).fill(date);
  const response = page.waitForResponse(
    (r) =>
      r.url().includes('/reports/control-reconciliation') &&
      r.url().includes('kind=' + kind) &&
      r.url().includes('asOfDate=' + date),
  );
  await page.getByRole('button', { name: 'Tampilkan', exact: true }).click();
  const r = await response;
  expect(r.status(), await r.text()).toBe(200);
  return (await r.json()) as ControlReconciliation;
}
for (const kind of ['ar', 'ap'] as const)
  test(
    kind.toUpperCase() +
      ' report keeps offsetting control differences visible, exports all details and preserves accounting',
    async ({ page }) => {
      const f = await fixture(page, kind),
        before = await snapshot(f.orgId);
      const data = await runReport(page, kind, '2026-09-30');
      expect(data.totals).toEqual({
        glBalance: 1150,
        subledgerBalance: 1150,
        difference: 0,
      });
      expect(
        data.accounts.find((a) => a.accountId === f.primary.id),
      ).toMatchObject({
        glBalance: 775,
        subledgerBalance: 700,
        difference: 75,
      });
      expect(
        data.accounts.find((a) => a.accountId === f.alternate.id),
      ).toMatchObject({
        glBalance: 375,
        subledgerBalance: 450,
        difference: -75,
        subledger: { documents: 600, settlements: -100, notes: -50 },
      });
      await expect(
        page
          .getByRole('status')
          .filter({ hasText: 'Review required: 2 control accounts' }),
      ).toBeVisible();
      const table = page.getByRole('table', {
          name: 'Control account reconciliation',
          exact: true,
        }),
        primary = table.getByRole('row').filter({ hasText: f.primary.code }),
        alternate = table
          .getByRole('row')
          .filter({ hasText: f.alternate.code });
      await expect(primary.getByRole('cell').nth(1)).toHaveText(formatIDR(775));
      await expect(primary.getByRole('cell').nth(2)).toHaveText(formatIDR(700));
      await expect(primary.getByRole('cell').nth(3)).toHaveText(formatIDR(75));
      await expect(alternate.getByRole('cell').nth(1)).toHaveText(
        formatIDR(375),
      );
      await expect(alternate.getByRole('cell').nth(3)).toHaveText(
        formatIDR(-75),
      );
      await expect(
        page.getByRole('region', {
          name: 'Reconciliation details for ' + f.primary.code,
        }),
      ).toContainText('QA historical reclass');
      await expect(
        page.getByRole('region', {
          name: 'Reconciliation details for ' + f.alternate.code,
        }),
      ).toContainText('MANUAL');
      const download = page.waitForEvent('download');
      await page
        .getByRole('button', { name: 'Export CSV', exact: true })
        .click();
      const csvFile = await download;
      expect(csvFile.suggestedFilename()).toBe(
        kind + '-control-reconciliation-2026-09-30.csv',
      );
      const csv = await readFile((await csvFile.path())!, 'utf8');
      expect(csv).toContain(
        'SUMMARY,Company totals,2026-09-30,1150,1150,0,Review required: 2',
      );
      expect(csv).toContain('775,700,75,Review required');
      expect(csv).toContain('375,450,-75,Review required');
      expect(csv).toContain('QA historical reclass');
      expect(csv).toContain('Notes,2026-09-30,,-50');
      const pdfDownload = Promise.race([page.waitForEvent('download'), page.waitForEvent('pageerror').then(error => { throw error; })]);
      await page
        .getByRole('button', { name: 'Export PDF', exact: true })
        .click();
      const pdf = await pdfDownload;
      await pdf.saveAs(test.info().outputPath(kind + '-control-report.pdf'));
      expect(pdf.suggestedFilename()).toBe(
        kind + '-control-reconciliation-2026-09-30.pdf',
      );
      expect(
        (await readFile((await pdf.path())!)).subarray(0, 4).toString(),
      ).toBe('%PDF');
      const later = await runReport(page, kind, '2026-10-05', true);
      expect(later.totals).toEqual({
        glBalance: 1450,
        subledgerBalance: 1450,
        difference: 0,
      });
      await expect(
        page
          .getByRole('status')
          .filter({ hasText: 'Review required: 2 control accounts' }),
      ).toBeVisible();
      await page.route('**/api/v1/reports/control-reconciliation**', (route) =>
        route.fulfill({
          status: 503,
          json: { error: 'QA report temporarily unavailable' },
        }),
      );
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      await expect(
        page.getByText(/QA report temporarily unavailable/),
      ).toBeVisible();
      for (const name of ['Export CSV', 'Export PDF', 'Print'])
        await expect(
          page.getByRole('button', { name, exact: true }),
        ).toBeDisabled();
      await page.unroute('**/api/v1/reports/control-reconciliation**');
      const recovered = page.waitForResponse((r) =>
        r.url().includes('/reports/control-reconciliation'),
      );
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      expect((await recovered).status()).toBe(200);
      await expect(
        page.getByRole('button', { name: 'Export CSV', exact: true }),
      ).toBeEnabled();
      expect(await snapshot(f.orgId)).toEqual(before);
    },
  );
