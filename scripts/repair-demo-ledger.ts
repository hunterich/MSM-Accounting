import assert from 'node:assert/strict';
import { Prisma, PrismaClient } from '@prisma/client';
import { advisoryLockKey } from '../lib/advisory-lock';
import { postBillToLedger } from '../lib/bill-posting';
import { postInvoiceSend } from '../lib/invoice-send-posting';
import { postArPaymentIfNeeded } from '../lib/payment-posting';
import { assertPeriodOpen } from '../lib/period-guard';
import { reverseJournalEntry } from '../lib/reverse-journal-entry';

const organizationId = 'org-demo';
const originalJournalNumber = 'JE-0001';
const reversalMemo = 'Reverse unlinked demo seed journal JE-0001';
const invoices = [
  { number: 'INV-0001', party: 'CST-0001', date: '2026-01-10', amount: 1_110_000, status: 'SENT', tax: 110_000 },
  { number: 'INV-0002', party: 'CST-0002', date: '2026-01-15', amount: 2_220_000, status: 'PAID', tax: 220_000 },
  { number: 'INV-0003', party: 'CST-0003', date: '2025-12-01', amount: 3_330_000, status: 'OVERDUE', tax: 330_000 },
] as const;
const bills = [
  { number: 'BILL-0001', party: 'VND-0001', date: '2026-01-05', amount: 800_000, status: 'OPEN' },
  { number: 'BILL-0002', party: 'VND-0002', date: '2026-01-10', amount: 1_500_000, status: 'PAID' },
  { number: 'BILL-0003', party: 'VND-0003', date: '2026-01-20', amount: 600_000, status: 'PENDING' },
] as const;
const receipts = [
  { number: 'ARP-0001', party: 'CST-0001', date: '2026-01-20', amount: 2_220_000, reference: 'TRF-001' },
  { number: 'ARP-0002', party: 'CST-0002', date: '2026-01-25', amount: 1_110_000, reference: 'TRF-002' },
] as const;

const day = (date: Date) => date.toISOString().slice(0, 10);
const hasAmount = (value: Prisma.Decimal, amount: number) => value.eq(amount);
type Tx = Prisma.TransactionClient;

async function alreadyPosted(
  tx: Tx, memo: string, date: string, ids: readonly string[], alternateMemos: string[],
  control: { description: string; side: 'debit' | 'credit'; amount: number },
) {
  const entries = await tx.journalEntry.findMany({
    where: { organizationId, memo: { in: [memo, ...alternateMemos] } },
    select: {
      id: true, memo: true, date: true, status: true, source: true,
      lines: { where: { description: control.description }, select: {
        debit: true, credit: true, account: { select: { organizationId: true } },
      } },
    },
  });
  if (entries.length === 0 && ids.length === 0) return false;
  const [entry] = entries;
  assert.ok(
    entries.length === 1 && ids.length === 1 && entry.id === ids[0]
      && entry.memo === memo && day(entry.date) === date && entry.status === 'POSTED' && entry.source === 'SYSTEM'
      && entry.lines.length === 1 && entry.lines[0].account.organizationId === organizationId
      && entry.lines[0][control.side].eq(control.amount)
      && entry.lines[0][control.side === 'debit' ? 'credit' : 'debit'].isZero(),
    `Unexpected journal history for ${memo}`,
  );
  return true;
}

async function repair(tx: Tx) {
  await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${advisoryLockKey('demo-ledger-fixtures')})`;
  const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { displayName: true, legalName: true } });
  assert.ok(org.legalName === 'PT. Demo Accounting' && org.displayName === 'PT. Demo Accounting',
    'The demo repair requires the original seeded Demo organization');
  const created = { invoices: 0, receipts: 0, bills: 0, reversals: 0 };

  for (const seed of invoices) {
    const row = await tx.salesInvoice.findUniqueOrThrow({
      where: { organizationId_number: { organizationId, number: seed.number } },
      include: { customer: { select: { code: true, organizationId: true } }, lines: true, charges: true },
    });
    if (await alreadyPosted(tx, `Sales recognition: ${seed.number}`, seed.date, row.postingJournalIds,
      [`COGS auto-post: ${seed.number}`, `Void invoice: ${seed.number}`, `Re-post invoice: ${seed.number}`],
      { description: `AR - ${seed.number}`, side: 'debit', amount: seed.amount })) continue;
    const subtotal = seed.amount - seed.tax;
    assert.ok(!row.postingTracked && !row.migrationBatchId && row.status === seed.status
      && row.customer.organizationId === organizationId && row.customer.code === seed.party
      && day(row.issueDate) === seed.date && hasAmount(row.totalAmount, seed.amount) && row.subtotal.eq(subtotal)
      && hasAmount(row.taxAmount, seed.tax) && row.discountAmount.isZero() && row.charges.length === 0
      && row.lines.length === 2 && row.lines.every(line => !line.itemId && line.lineSubtotal.eq(subtotal / 2)),
    `Unexpected legacy demo invoice ${seed.number}`);
    await postInvoiceSend(tx, organizationId, row.id);
    created.invoices += 1;
  }

  const bank = await tx.account.findUniqueOrThrow({
    where: { organizationId_code: { organizationId, code: '1-1100' } },
    select: { id: true },
  });
  for (const seed of receipts) {
    const row = await tx.aRPayment.findUniqueOrThrow({
      where: { organizationId_number: { organizationId, number: seed.number } },
      include: { customer: { select: { code: true, organizationId: true } }, allocations: true },
    });
    if (await alreadyPosted(tx, `AR receipt: ${seed.number}`, seed.date, row.journalEntryId ? [row.journalEntryId] : [],
      [`Void AR receipt: ${seed.number}`],
      { description: `AR settlement - ${seed.number}`, side: 'credit', amount: seed.amount })) continue;
    const postedFeed = await tx.bankTransaction.count({
      where: { organizationId, reference: seed.reference, journalEntryId: { not: null } },
    });
    assert.ok(row.status === 'COMPLETED' && row.source === 'MANUAL' && row.method === 'BANK_TRANSFER'
      && row.customer.organizationId === organizationId && row.customer.code === seed.party
      && day(row.date) === seed.date && hasAmount(row.totalAmount, seed.amount) && !row.arAccountId
      && row.reference === seed.reference && row.allocations.length === 0
      && (!row.depositAccountId || row.depositAccountId === bank.id) && postedFeed === 0,
    `Unexpected legacy demo receipt ${seed.number}`);
    await tx.aRPayment.update({ where: { id: row.id }, data: { depositAccountId: bank.id } });
    await postArPaymentIfNeeded(tx, organizationId, row.id);
    created.receipts += 1;
  }

  for (const seed of bills) {
    const row = await tx.bill.findUniqueOrThrow({
      where: { organizationId_number: { organizationId, number: seed.number } },
      include: { vendor: { select: { code: true, organizationId: true } }, lines: true, charges: true },
    });
    if (await alreadyPosted(tx, `Bill: ${seed.number}`, seed.date, row.journalEntryId ? [row.journalEntryId] : [],
      [`Void bill: ${seed.number}`, `Re-post bill: ${seed.number}`],
      { description: `AP - ${seed.number}`, side: 'credit', amount: seed.amount })) continue;
    assert.ok(!row.migrationBatchId && !row.poId && row.status === seed.status && !row.taxable
      && !row.apAccountId && row.vendor.organizationId === organizationId
      && row.vendor.code === seed.party && day(row.issueDate) === seed.date
      && hasAmount(row.totalAmount, seed.amount) && row.charges.length === 0 && row.lines.length === 1
      && row.lines.every(line => !line.itemId && !line.purchaseOrderLineId && !line.assetId
        && line.description === 'Supplies purchase' && hasAmount(line.lineTotal, seed.amount)),
    `Unexpected legacy demo bill ${seed.number}`);
    await assertPeriodOpen(tx, organizationId, row.issueDate);
    await postBillToLedger(tx, organizationId, row);
    created.bills += 1;
  }

  const original = await tx.journalEntry.findUnique({
    where: { organizationId_entryNo: { organizationId, entryNo: originalJournalNumber } },
    include: { lines: { orderBy: { lineNo: 'asc' }, include: { account: { select: { code: true, organizationId: true } } } } },
  });
  if (original) {
    assert.ok(original.status === 'POSTED' && original.source === 'MANUAL' && !original.postedAt && !original.createdById
      && original.memo === 'Revenue recognition Jan' && day(original.date) === '2026-01-15'
      && hasAmount(original.totalDebit, 1_000_000) && hasAmount(original.totalCredit, 1_000_000)
      && original.lines.length === 2 && original.lines[0].account.code === '1-1200'
      && original.lines.every(line => line.account.organizationId === organizationId)
      && hasAmount(original.lines[0].debit, 1_000_000) && original.lines[0].credit.isZero()
      && original.lines[1].account.code === '4-1000' && original.lines[1].debit.isZero()
      && hasAmount(original.lines[1].credit, 1_000_000), 'Unexpected legacy demo manual journal');
    const reversals = await tx.journalEntry.findMany({ where: { organizationId, memo: reversalMemo }, include: { lines: true } });
    if (reversals.length) {
      const [reversal] = reversals;
      assert.ok(reversals.length === 1 && reversal.status === 'POSTED' && reversal.source === 'REVERSAL'
        && day(reversal.date) === day(original.date) && reversal.lines.length === original.lines.length
        && original.lines.every(line => reversal.lines.some(offset =>
          offset.accountId === line.accountId && offset.debit.eq(line.credit) && offset.credit.eq(line.debit))),
      'Unexpected reversal history for demo manual journal');
    } else {
      await assertPeriodOpen(tx, organizationId, original.date);
      await reverseJournalEntry(tx, original.id, { date: original.date, memo: reversalMemo });
      created.reversals += 1;
    }
  }
  return created;
}

async function main() {
  assert.ok(process.argv.length <= 3 && (!process.argv[2] || process.argv[2] === '--apply'), 'Usage: tsx scripts/repair-demo-ledger.ts [--apply]');
  const apply = process.argv[2] === '--apply';
  const db = new PrismaClient();
  let planned: Awaited<ReturnType<typeof repair>> | undefined;
  const rollback = new Error('Roll back the demo repair dry run');
  try {
    await db.$transaction(async tx => {
      planned = await repair(tx);
      if (!apply) throw rollback;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 45_000 });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    await db.$disconnect();
  }
  console.log(JSON.stringify({ applied: apply, ...planned }));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
