/**
 * Integration: editing a posted (period-open) document reverses its journal and
 * re-posts from the edited data, so the GL stays balanced and reflects the new
 * amount. This is the engine behind the bill/invoice "edit-after-post" route path
 * (lib/repost.ts + postBillToLedger). Non-inventory only, matching the v1 scope.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { postBillToLedger } from '../../bill-posting';
import { reverseBillPosting } from '../../repost';
import {
  prisma,
  createTestOrg,
  createVendor,
  assertTrialBalanced,
  accountBalance,
  cleanupOrg,
  disconnect,
} from './harness';

afterAll(async () => {
  await disconnect();
});

const DATE = new Date('2026-03-15T00:00:00.000Z');

async function postExpenseBill(orgId: string, billId: string, number: string, amount: number) {
  await prisma.$transaction((tx) =>
    postBillToLedger(tx, orgId, {
      id: billId,
      number,
      issueDate: DATE,
      apAccountId: null,
      taxable: false,
      taxInclusive: false,
      taxRate: 0,
      // expense line (no itemId) → debits the cogsExpense default
      lines: [{ id: 'l1', itemId: null, quantity: 1, price: amount, lineTotal: amount, purchaseOrderLineId: null }],
    }),
  );
}

describe('edit-after-post: reverse + re-post keeps the GL balanced and correct', () => {
  it('reversing a posted expense bill nets its accounts to zero', async () => {
    const org = await createTestOrg();
    const vendorId = await createVendor(org.orgId);
    const bill = await prisma.bill.create({
      data: { organizationId: org.orgId, number: 'BILL-REV', vendorId, issueDate: DATE, status: 'OPEN' },
      select: { id: true, number: true },
    });

    await postExpenseBill(org.orgId, bill.id, bill.number, 50000);
    await assertTrialBalanced(org.orgId, 'after post');
    expect(await accountBalance(org.orgId, org.accounts.apControl)).toBeCloseTo(-50000, 2);
    expect(await accountBalance(org.orgId, org.accounts.cogsExpense)).toBeCloseTo(50000, 2);

    const posted = await prisma.bill.findUniqueOrThrow({ where: { id: bill.id }, select: { journalEntryId: true } });
    await prisma.$transaction((tx) =>
      reverseBillPosting(tx, org.orgId, { id: bill.id, number: bill.number, poId: null, journalEntryId: posted.journalEntryId }, { date: DATE }),
    );

    // Original post + storno reversal cancel out → both accounts back to zero.
    await assertTrialBalanced(org.orgId, 'after reverse');
    expect(await accountBalance(org.orgId, org.accounts.apControl)).toBeCloseTo(0, 2);
    expect(await accountBalance(org.orgId, org.accounts.cogsExpense)).toBeCloseTo(0, 2);

    await cleanupOrg(org.orgId);
  });

  it('reverse → re-post at a new amount leaves the GL reflecting only the new amount', async () => {
    const org = await createTestOrg();
    const vendorId = await createVendor(org.orgId);
    const bill = await prisma.bill.create({
      data: { organizationId: org.orgId, number: 'BILL-EDIT', vendorId, issueDate: DATE, status: 'OPEN' },
      select: { id: true, number: true },
    });

    // Post 50,000, then "edit" it to 80,000 the way the route does: reverse, then re-post.
    await postExpenseBill(org.orgId, bill.id, bill.number, 50000);
    const posted = await prisma.bill.findUniqueOrThrow({ where: { id: bill.id }, select: { journalEntryId: true } });

    await prisma.$transaction(async (tx) => {
      await reverseBillPosting(tx, org.orgId, { id: bill.id, number: bill.number, poId: null, journalEntryId: posted.journalEntryId }, { date: DATE });
      await postBillToLedger(tx, org.orgId, {
        id: bill.id, number: bill.number, issueDate: DATE, apAccountId: null,
        taxable: false, taxInclusive: false, taxRate: 0,
        lines: [{ id: 'l1', itemId: null, quantity: 1, price: 80000, lineTotal: 80000, purchaseOrderLineId: null }],
      });
    });

    await assertTrialBalanced(org.orgId, 'after edit re-post');
    // Net of original(50k) − reversal(50k) + re-post(80k) = 80k exactly.
    expect(await accountBalance(org.orgId, org.accounts.apControl)).toBeCloseTo(-80000, 2);
    expect(await accountBalance(org.orgId, org.accounts.cogsExpense)).toBeCloseTo(80000, 2);

    await cleanupOrg(org.orgId);
  });
});
