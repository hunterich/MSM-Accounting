import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, describe, expect, it } from 'vitest';
import { postBillToLedger } from '../../bill-posting';
import { MoneyDecimal } from '../../money-decimal';
import { voidDebitNote } from '../../note-void';
import { voidPurchaseReturn } from '../../return-void';
import { POST as previewReturn } from '@/src/app/api/v1/purchase-returns/preview/route';
import { POST as createReturn } from '@/src/app/api/v1/purchase-returns/route';
import { PUT as updateReturn } from '@/src/app/api/v1/purchase-returns/[id]/route';
import { POST as createDebit } from '@/src/app/api/v1/debit-notes/route';
import { PUT as applyDebit } from '@/src/app/api/v1/debit-notes/[id]/route';
import { accountBalance, assertTrialBalanced, cleanupOrg, createTestOrg, createVendor, disconnect, prisma } from './harness';

afterAll(disconnect);
const date = '2026-09-01';
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const cents = (value: string | number) => new MoneyDecimal(value).toFixed(2);

describe('partial purchase return rounding', () => {
  it.each([
    { mode: 'exclusive', inclusive: false, billTax: '0.77', billTotal: '9.77', noteTax: '0.73', noteTotal: '9.40',
      first: ['3.34', '0.37', '3.71'], second: ['3.33', '0.36', '3.69'] },
    { mode: 'inclusive', inclusive: true, billTax: '0.69', billTotal: '9.00', noteTax: '0.66', noteTotal: '8.67',
      first: ['3.34', '0.33', '3.34'], second: ['3.33', '0.33', '3.33'] },
  ])('previews, saves and posts successive partial returns with $mode PPN at the agreed supplier price', async ({
    inclusive, billTax, billTotal, noteTax, noteTotal, first, second,
  }) => {
    const org = await createTestOrg();
    const user = await prisma.user.create({ data: { email: `purchase-return-${randomUUID()}@test.local`, fullName: 'Purchase Return QA' } });
    try {
      const vendorId = await createVendor(org.orgId);
      const returnAccount = await prisma.account.create({ data: {
        organizationId: org.orgId, code: '5220', name: 'Purchase Returns', type: 'EXPENSE', normalSide: 'DEBIT',
      } });
      await prisma.organization.update({ where: { id: org.orgId }, data: {
        accountDefaults: { ...org.accounts, apReturn: returnAccount.id },
      } });
      const bill = await prisma.bill.create({ data: {
        organizationId: org.orgId, vendorId, number: 'BILL-RETURN-ROUNDING', issueDate: new Date(date), status: 'OPEN',
        taxable: true, taxInclusive: inclusive, taxRate: 11, subtotal: '9.00', taxAmount: billTax, totalAmount: billTotal,
        lines: { create: [
          { lineNo: 1, description: 'Taxable purchase', quantity: 1, price: '7.00', lineTotal: '7.00', taxable: true, accountId: org.accounts.cogsExpense },
          { lineNo: 2, description: 'Exempt purchase', quantity: 1, price: '2.00', lineTotal: '2.00', taxable: false, accountId: org.accounts.cogsExpense },
        ] },
      }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
      await prisma.$transaction(tx => postBillToLedger(tx, org.orgId, bill));

      const request = (method: 'POST' | 'PUT', body: unknown) => new NextRequest('http://localhost/api/v1/test', {
        method,
        headers: { 'x-org-id': org.orgId, 'x-user-id': user.id, 'x-role-type': 'ADMIN', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const terms = { billId: bill.id, vendorId, applyTax: true, taxIncluded: inclusive, taxRate: '11.00' };
      const partial = { lineKey: bill.lines[0].id, qtyReturn: '0.50004', price: '6.670' };

      async function returnAndDebit(line: typeof partial, expected: string[], edit = false) {
        const input = { ...terms, returnDate: date, lines: [line], status: 'PENDING_DEBIT_NOTE' };
        let draftId: string | undefined;
        if (edit) {
          const draft = await createReturn(request('POST', {
            ...input, status: 'DRAFT', lines: [{ ...line, qtyReturn: '0.25' }],
          }));
          expect(draft.status, await draft.clone().text()).toBe(201);
          draftId = (await draft.json()).id;
        }
        const preview = await previewReturn(request('POST', { ...input, returnId: draftId }));
        expect(preview.status, await preview.clone().text()).toBe(200);
        const value = await preview.json();
        expect([value.subtotal, value.taxAmount, value.totalAmount].map(cents)).toEqual(expected);
        expect([value.lines[0].lineTotal, value.lines[0].taxAmount].map(cents)).toEqual(expected.slice(0, 2));
        const submit = { ...input, expectedValuation: { totalAmount: value.totalAmount, taxAmount: value.taxAmount } };
        if (draftId) {
          const stale = await updateReturn(request('PUT', {
            ...submit, expectedValuation: { totalAmount: first[2], taxAmount: first[1] },
          }), context(draftId));
          expect(stale.status, await stale.clone().text()).toBe(409);
        }
        const saved = draftId
          ? await updateReturn(request('PUT', submit), context(draftId))
          : await createReturn(request('POST', { ...submit, subtotal: 999, totalAmount: 999, lines: [{ ...line, lineTotal: 999 }] }));
        expect(saved.status, await saved.clone().text()).toBe(draftId ? 200 : 201);
        const { id } = await saved.json();
        const ret = await prisma.purchaseReturn.findUniqueOrThrow({ where: { id }, include: { lines: true } });
        expect([ret.subtotal, ret.taxAmount, ret.totalAmount].map(amount => amount.toFixed(2))).toEqual(expected);
        expect(ret.lines[0].qtyReturn.toFixed(4)).toBe(new MoneyDecimal(line.qtyReturn).toFixed(4));
        expect(ret.lines[0].lineTotal.toFixed(2)).toBe(expected[0]);
        expect(ret.lines[0].taxAmount?.toFixed(2)).toBe(expected[1]);

        const debit = await createDebit(request('POST', {
          vendorId, sourceBillId: bill.id, purchaseReturnId: ret.id, date,
          amount: value.totalAmount, taxAmount: value.taxAmount, applyTax: ret.applyTax,
        }));
        expect(debit.status, await debit.clone().text()).toBe(201);
        const noteId = (await debit.json()).id;
        if (edit) {
          const wrongTax = await applyDebit(request('PUT', { status: 'APPLIED', taxAmount: '0.00' }), context(noteId));
          expect(wrongTax.status, await wrongTax.clone().text()).toBe(422);
          expect(await prisma.debitNote.findUniqueOrThrow({ where: { id: noteId } })).toMatchObject({ status: 'DRAFT', journalEntryId: null });
        }
        const applied = await applyDebit(request('PUT', { status: 'APPLIED' }), context(noteId));
        expect(applied.status, await applied.clone().text()).toBe(200);
        const note = await prisma.debitNote.findUniqueOrThrow({ where: { id: noteId }, include: { journalEntry: { include: { lines: true } } } });
        expect(note.amount.toFixed(2)).toBe(expected[2]);
        expect(note.taxAmount.toFixed(2)).toBe(expected[1]);
        if (!note.journalEntry) throw new Error('Debit note did not post');
        const posted = new Map(note.journalEntry.lines.map(entry => [entry.accountId, [entry.debit.toFixed(2), entry.credit.toFixed(2)]]));
        expect(posted.get(org.accounts.apControl)).toEqual([expected[2], '0.00']);
        expect(posted.get(returnAccount.id)).toEqual(['0.00', ret.totalAmount.minus(ret.taxAmount).toFixed(2)]);
        expect(posted.get(org.accounts.apTax)).toEqual(expected[1] === '0.00' ? undefined : ['0.00', expected[1]]);
        return { returnId: ret.id, noteId: note.id };
      }

      const original = await returnAndDebit({ ...partial, lineKey: `${bill.number}-1` }, first);
      if (!inclusive) {
        // Historical returns kept PPN on the header and used a bill-number line key.
        await prisma.purchaseReturnLine.updateMany({ where: { purchaseReturnId: original.returnId },
          data: { lineKey: `${bill.number}-1`, taxAmount: null } });
      }
      const newPrice = await previewReturn(request('POST', { ...terms, lines: [{ ...partial, price: '6.69' }] }));
      expect(newPrice.status, await newPrice.clone().text()).toBe(200);
      expect(cents((await newPrice.json()).subtotal)).toBe('3.35');
      await returnAndDebit(partial, second, true);
      await returnAndDebit({ lineKey: bill.lines[1].id, qtyReturn: '1', price: '2.00' }, ['2.00', '0.00', '2.00']);
      const overReturn = await previewReturn(request('POST', { ...terms, lines: [{ ...partial, qtyReturn: '0.0001' }] }));
      expect(overReturn.status).toBe(422);

      if (!inclusive) {
        await prisma.$transaction(tx => voidDebitNote(tx, org.orgId, original.noteId, { date: new Date(date) }));
        await prisma.$transaction(tx => voidPurchaseReturn(tx, org.orgId, original.returnId, { date: new Date(date) }));
        await returnAndDebit(partial, first);
      }
      const applied = await prisma.debitNote.aggregate({
        where: { sourceBillId: bill.id, status: 'APPLIED' }, _sum: { amount: true, taxAmount: true },
      });
      expect(applied._sum.amount?.toFixed(2)).toBe(noteTotal);
      expect(applied._sum.taxAmount?.toFixed(2)).toBe(noteTax);
      expect(cents(await accountBalance(org.orgId, org.accounts.apControl))).toBe(new MoneyDecimal(noteTotal).minus(billTotal).toFixed(2));
      await assertTrialBalanced(org.orgId, 'partial purchase returns');
    } finally {
      await prisma.debitNote.deleteMany({ where: { organizationId: org.orgId } });
      await prisma.purchaseReturn.deleteMany({ where: { organizationId: org.orgId } });
      await prisma.journalEntry.deleteMany({ where: { organizationId: org.orgId } });
      await cleanupOrg(org.orgId);
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
