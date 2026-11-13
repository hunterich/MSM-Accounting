import { test, expect } from '@playwright/test';
import { accountingCompany, cleanupAccountingCompany, db } from './accounting-helpers';

test.setTimeout(120_000);
test.afterEach(cleanupAccountingCompany);
test.afterAll(() => db.$disconnect());

for (const kind of ['ar', 'ap'] as const) {
  test(`${kind}: linked note blocks return deletion until explicitly unlinked`, async ({ page }) => {
    const { orgId, customer, vendor } = await accountingCompany(page);
    const date = new Date('2026-09-01T00:00:00Z');
    const invoice = await db.salesInvoice.create({ data: { organizationId: orgId, customerId: customer.id, number: 'QA-INV', issueDate: date } });
    const bill = await db.bill.create({ data: { organizationId: orgId, vendorId: vendor.id, number: 'QA-BILL', issueDate: date } });
    const ret = kind === 'ar'
      ? await db.salesReturn.create({ data: { organizationId: orgId, customerId: customer.id, invoiceId: invoice.id, number: 'QA-SR', returnDate: date } })
      : await db.purchaseReturn.create({ data: { organizationId: orgId, vendorId: vendor.id, billId: bill.id, number: 'QA-PR', returnDate: date } });
    const note = kind === 'ar'
      ? await db.creditNote.create({ data: { organizationId: orgId, customerId: customer.id, sourceInvoiceId: invoice.id, salesReturnId: ret.id, number: 'QA-CN', date, amount: 100 } })
      : await db.debitNote.create({ data: { organizationId: orgId, vendorId: vendor.id, sourceBillId: bill.id, purchaseReturnId: ret.id, number: 'QA-DN', date, amount: 100 } });
    await page.goto(kind === 'ar' ? '/ar/credits' : '/ap/debits');
    await page.getByRole('button', { name: kind === 'ar' ? 'Sales Returns' : 'Purchase Returns', exact: true }).click();
    await page.getByRole('row').filter({ hasText: kind === 'ar' ? 'QA-SR' : 'QA-PR' }).getByRole('button', { name: 'Open' }).click();
    const messages: string[] = [];
    page.on('dialog', dialog => { messages.push(dialog.message()); void dialog.accept(); });
    await page.getByTitle('Delete', { exact: true }).filter({ visible: true }).click();
    await expect.poll(() => messages.some(m => m.includes(kind === 'ar' ? 'QA-CN (DRAFT)' : 'QA-DN (DRAFT)'))).toBe(true);
    expect(kind === 'ar'
      ? (await db.creditNote.findUniqueOrThrow({ where: { id: note.id } })).salesReturnId
      : (await db.debitNote.findUniqueOrThrow({ where: { id: note.id } })).purchaseReturnId).toBe(ret.id);

    await page.locator('.workbench-doc-tab-catalog').click();
    await page.getByRole('button', { name: kind === 'ar' ? 'Credit Notes' : 'Debit Notes', exact: true }).click();
    await page.getByRole('row').filter({ hasText: kind === 'ar' ? 'QA-CN' : 'QA-DN' }).getByRole('button', { name: 'View' }).click();
    await page.getByRole('button', { name: 'Unlink return' }).click();
    await expect.poll(async () => kind === 'ar'
      ? (await db.creditNote.findUniqueOrThrow({ where: { id: note.id } })).salesReturnId
      : (await db.debitNote.findUniqueOrThrow({ where: { id: note.id } })).purchaseReturnId).toBeNull();
    const audit = await db.auditLog.findFirstOrThrow({ where: { organizationId: orgId, entityId: note.id, action: 'UPDATE', payload: { path: ['returnLink', 'before'], equals: ret.id } } });
    expect(audit.payload).toMatchObject({ returnLink: { before: ret.id, after: null } });
    await page.getByRole('button', { name: 'Audit / Journal' }).click();
    await expect(page.getByText('For recorded changes, including return links, see Data & Tools → Audit Log.')).toBeVisible();

    await page.locator('.workbench-doc-tab-catalog').click();
    await page.getByRole('button', { name: kind === 'ar' ? 'Sales Returns' : 'Purchase Returns', exact: true }).click();
    await page.getByRole('row').filter({ hasText: kind === 'ar' ? 'QA-SR' : 'QA-PR' }).getByRole('button', { name: 'Open' }).click();
    await page.getByTitle('Delete', { exact: true }).filter({ visible: true }).click();
    await expect.poll(async () => kind === 'ar'
      ? db.salesReturn.findUnique({ where: { id: ret.id } })
      : db.purchaseReturn.findUnique({ where: { id: ret.id } })).toBeNull();
    expect(await db.journalEntry.count({ where: { organizationId: orgId } })).toBe(0);
  });
}
