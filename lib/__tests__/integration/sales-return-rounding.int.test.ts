import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, describe, expect, it } from 'vitest';
import { MoneyDecimal } from '../../money-decimal';
import { postInvoiceSend } from '../../invoice-send-posting';
import { voidCreditNote } from '../../note-void';
import { voidSalesReturn } from '../../return-void';
import { POST as previewReturn } from '@/src/app/api/v1/sales-returns/preview/route';
import { POST as createReturn } from '@/src/app/api/v1/sales-returns/route';
import { PUT as updateReturn } from '@/src/app/api/v1/sales-returns/[id]/route';
import { POST as createCredit } from '@/src/app/api/v1/credit-notes/route';
import { PUT as applyCredit } from '@/src/app/api/v1/credit-notes/[id]/route';
import { assertTrialBalanced, cleanupOrg, createCustomer, createTestOrg, disconnect, prisma } from './harness';

afterAll(disconnect);
const date = '2026-09-01';
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const cents = (value: string | number) => new MoneyDecimal(value).toFixed(2);

describe('partial sales return rounding', () => {
  it.each([
    { mode: 'exclusive', inclusive: false, sourceTax: '0.73', invoiceTotal: '11.40',
      parts: [['2.22', '0.24', '2.46'], ['2.23', '0.25', '2.48'], ['2.22', '0.24', '2.46']] },
    { mode: 'inclusive', inclusive: true, sourceTax: '0.66', invoiceTotal: '10.67',
      parts: [['2.22', '0.22', '2.22'], ['2.23', '0.22', '2.23'], ['2.22', '0.22', '2.22']] },
  ])('previews, saves and posts three partial returns with $mode PPN and a separate exempt line', async ({
    inclusive, sourceTax, invoiceTotal, parts,
  }) => {
    const org = await createTestOrg();
    const user = await prisma.user.create({ data: { email: `return-rounding-${randomUUID()}@test.local`, fullName: 'Return QA' } });
    try {
      const customerId = await createCustomer(org.orgId);
      const taxAccount = await prisma.account.create({ data: {
        organizationId: org.orgId, code: '2300', name: 'Output Tax', type: 'LIABILITY', normalSide: 'CREDIT', isPostable: true,
      } });
      const returnAccount = await prisma.account.create({ data: {
        organizationId: org.orgId, code: '4190', name: 'Sales Returns', type: 'EXPENSE', normalSide: 'DEBIT', isPostable: true,
      } });
      await prisma.organization.update({ where: { id: org.orgId }, data: {
        accountDefaults: { ...org.accounts, arTax: taxAccount.id, arReturn: returnAccount.id },
      } });
      const invoice = await prisma.salesInvoice.create({ data: {
        organizationId: org.orgId, customerId, number: 'INV-RETURN-ROUNDING', issueDate: new Date(date), status: 'SENT',
        subtotal: '10.67', taxEnabled: true, taxInclusive: inclusive, taxRate: 11, taxAmount: sourceTax, totalAmount: invoiceTotal,
        lines: { create: [
          { lineNo: 1, description: 'Taxable product', quantity: 3, price: '2.22', lineSubtotal: '6.67', taxable: true },
          { lineNo: 2, description: 'Exempt product', quantity: 1, price: '4.00', lineSubtotal: '4.00', taxable: false },
        ] },
      }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
      await prisma.$transaction(tx => postInvoiceSend(tx, org.orgId, invoice.id));

      const request = (method: 'POST' | 'PUT', body: unknown) => new NextRequest('http://localhost/api/v1/test', {
        method,
        headers: { 'x-org-id': org.orgId, 'x-user-id': user.id, 'x-role-type': 'ADMIN', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      async function returnAndCredit(index: number, expected: string[], edit = false) {
        const line = { sourceInvoiceLineId: invoice.lines[index].id, qtyReturn: '1.00004', goodsReceived: false };
        const input = { customerId, invoiceId: invoice.id, returnDate: date, lines: [line], status: 'APPROVED' };
        let draftId: string | undefined;
        if (edit) {
          const draft = await createReturn(request('POST', { ...input, status: 'DRAFT', lines: [{ ...line, qtyReturn: '0.5' }] }));
          expect(draft.status, await draft.clone().text()).toBe(201);
          draftId = (await draft.json()).id;
        }
        const preview = await previewReturn(request('POST', { ...input, returnId: draftId }));
        expect(preview.status, await preview.clone().text()).toBe(200);
        const valuation = await preview.json();
        expect([valuation.subtotal, valuation.taxAmount, valuation.totalAmount].map(cents)).toEqual(expected);
        expect([valuation.lines[0].lineTotal, valuation.lines[0].taxAmount].map(cents)).toEqual(expected.slice(0, 2));
        const submit = { ...input, expectedValuation: { totalAmount: valuation.totalAmount, taxAmount: valuation.taxAmount } };
        if (draftId) {
          const changed = await updateReturn(request('PUT', {
            ...submit, expectedValuation: { ...submit.expectedValuation, totalAmount: '1.00' },
          }), context(draftId));
          expect(changed.status, await changed.clone().text()).toBe(409);
        }
        const saved = draftId
          ? await updateReturn(request('PUT', submit), context(draftId))
          : await createReturn(request('POST', submit));
        expect(saved.status, await saved.clone().text()).toBe(draftId ? 200 : 201);
        const { id } = await saved.json();
        const ret = await prisma.salesReturn.findUniqueOrThrow({ where: { id }, include: { lines: true } });
        expect([ret.subtotal, ret.taxAmount, ret.totalAmount].map(value => value.toFixed(2))).toEqual(expected);
        expect(ret.lines[0].qtyReturn.toFixed(4)).toBe('1.0000');
        expect(ret.lines[0].lineTotal.toFixed(2)).toBe(expected[0]);
        expect(ret.lines[0].taxAmount?.toFixed(2)).toBe(expected[1]);

        const credit = await createCredit(request('POST', {
          customerId, sourceInvoiceId: invoice.id, salesReturnId: ret.id, date,
          amount: ret.totalAmount.toFixed(2), taxAmount: ret.taxAmount.toFixed(2), applyTax: ret.applyTax,
        }));
        expect(credit.status, await credit.clone().text()).toBe(201);
        const noteId = (await credit.json()).id;
        if (edit) {
          const wrongTax = await applyCredit(request('PUT', { status: 'APPLIED', taxAmount: '0.00' }), context(noteId));
          expect(wrongTax.status, await wrongTax.clone().text()).toBe(422);
          expect(await prisma.creditNote.findUniqueOrThrow({ where: { id: noteId } })).toMatchObject({ status: 'DRAFT', journalEntryId: null });
        }
        const apply = await applyCredit(request('PUT', { status: 'APPLIED' }), context(noteId));
        expect(apply.status, await apply.clone().text()).toBe(200);
        const note = await prisma.creditNote.findUniqueOrThrow({
          where: { id: noteId }, include: { journalEntry: { include: { lines: true } } },
        });
        expect(note.amount.toFixed(2)).toBe(expected[2]);
        expect(note.taxAmount.toFixed(2)).toBe(expected[1]);
        if (!note.journalEntry) throw new Error('Credit note did not post');
        const posted = new Map(note.journalEntry.lines.map(entry => [entry.accountId, [entry.debit.toFixed(2), entry.credit.toFixed(2)]]));
        expect(posted.get(org.accounts.arControl)).toEqual(['0.00', expected[2]]);
        expect(posted.get(returnAccount.id)).toEqual([ret.totalAmount.minus(ret.taxAmount).toFixed(2), '0.00']);
        expect(posted.get(taxAccount.id)).toEqual(expected[1] === '0.00' ? undefined : [expected[1], '0.00']);
        return { returnId: ret.id, noteId: note.id };
      }

      await returnAndCredit(0, parts[0]);
      const middle = await returnAndCredit(0, parts[1], true);
      await returnAndCredit(0, parts[2]);
      await returnAndCredit(1, ['4.00', '0.00', '4.00']);

      // Replacing a voided middle return must pick up its saved cent even
      // though it now comes after the other two installments.
      if (!inclusive) {
        await prisma.$transaction(tx => voidCreditNote(tx, org.orgId, middle.noteId, { date: new Date(date) }));
        await prisma.$transaction(tx => voidSalesReturn(tx, org.orgId, middle.returnId, { date: new Date(date) }));
        await returnAndCredit(0, parts[1]);
      }
      const notes = await prisma.creditNote.aggregate({
        where: { sourceInvoiceId: invoice.id, status: 'APPLIED' }, _sum: { amount: true, taxAmount: true },
      });
      expect(notes._sum.amount?.toFixed(2)).toBe(invoiceTotal);
      expect(notes._sum.taxAmount?.toFixed(2)).toBe(sourceTax);
      expect((await prisma.salesInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe('PAID');
      await assertTrialBalanced(org.orgId, 'partial sales return');
    } finally {
      await cleanupOrg(org.orgId);
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
