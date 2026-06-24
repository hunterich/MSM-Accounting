/**
 * Void round-trip invariants for credit/debit notes: applying posts a balanced
 * entry; voiding reverses it so the trial balance and AR/AP control return to
 * zero, with exactly two posted entries (post + reversal) that net out.
 *
 * Run with:  npm run test:int
 */
import { afterAll, describe, expect, it } from 'vitest';
import { postCreditNoteOnApply } from '../../credit-note-posting';
import { postDebitNoteOnApply } from '../../debit-note-posting';
import { voidCreditNote, voidDebitNote } from '../../note-void';
import {
  prisma,
  createTestOrg,
  createCustomer,
  createVendor,
  assertTrialBalanced,
  accountBalance,
  journalEntryCount,
  cleanupOrg,
  disconnect,
} from './harness';

afterAll(async () => {
  await disconnect();
});

const DATE = new Date('2026-06-20T00:00:00.000Z');

describe('credit note void round-trip', () => {
  it('apply posts DR return / CR AR; void reverses both legs to zero', async () => {
    const org = await createTestOrg();
    const customerId = await createCustomer(org.orgId);

    const cn = await prisma.creditNote.create({
      data: {
        organizationId: org.orgId,
        number: 'CN-VOID-1',
        customerId,
        date: DATE,
        amount: 5000,
        applyTax: false,
        status: 'DRAFT',
        returnAccountId: org.accounts.salesRevenue,
        arAccountId: org.accounts.arControl,
      },
      select: { id: true },
    });

    await prisma.$transaction((tx) => postCreditNoteOnApply(tx, cn.id));
    await assertTrialBalanced(org.orgId, 'credit note applied');
    // AR control was credited 5000 (debit-positive => negative).
    expect(await accountBalance(org.orgId, org.accounts.arControl)).toBeCloseTo(-5000, 2);

    await prisma.$transaction((tx) => voidCreditNote(tx, org.orgId, cn.id, { date: DATE }));

    await assertTrialBalanced(org.orgId, 'credit note voided');
    expect(await accountBalance(org.orgId, org.accounts.arControl)).toBeCloseTo(0, 2);
    expect(await journalEntryCount(org.orgId)).toBe(2); // post + reversal
    const voided = await prisma.creditNote.findUnique({ where: { id: cn.id }, select: { status: true } });
    expect(voided?.status).toBe('VOID');

    await cleanupOrg(org.orgId);
  });
});

describe('debit note void round-trip', () => {
  it('apply posts DR AP / CR return; void reverses both legs to zero', async () => {
    const org = await createTestOrg();
    const vendorId = await createVendor(org.orgId);

    const dn = await prisma.debitNote.create({
      data: {
        organizationId: org.orgId,
        number: 'DN-VOID-1',
        vendorId,
        date: DATE,
        amount: 4000,
        applyTax: false,
        status: 'DRAFT',
        apAccountId: org.accounts.apControl,
        returnAccountId: org.accounts.cogsExpense,
      },
      select: { id: true },
    });

    await prisma.$transaction((tx) => postDebitNoteOnApply(tx, dn.id));
    await assertTrialBalanced(org.orgId, 'debit note applied');
    // AP control was debited 4000 (debit-positive => positive).
    expect(await accountBalance(org.orgId, org.accounts.apControl)).toBeCloseTo(4000, 2);

    await prisma.$transaction((tx) => voidDebitNote(tx, org.orgId, dn.id, { date: DATE }));

    await assertTrialBalanced(org.orgId, 'debit note voided');
    expect(await accountBalance(org.orgId, org.accounts.apControl)).toBeCloseTo(0, 2);
    expect(await journalEntryCount(org.orgId)).toBe(2);
    const voided = await prisma.debitNote.findUnique({ where: { id: dn.id }, select: { status: true } });
    expect(voided?.status).toBe('VOID');

    await cleanupOrg(org.orgId);
  });
});
