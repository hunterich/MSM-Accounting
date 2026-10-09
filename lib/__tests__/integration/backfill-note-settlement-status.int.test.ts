import { afterAll, describe, expect, it } from 'vitest';
import { backfillNoteSettlementStatus } from '@/lib/backfill-note-settlement-status';
import { prisma, createTestOrg, createCustomer, createVendor, cleanupOrg, disconnect } from './harness';

afterAll(disconnect);
const date = new Date('2026-07-10');

describe('legacy note settlement status backfill', () => {
  for (const kind of ['ar', 'ap'] as const) {
    it(`${kind}: previews without writes, applies only eligible settled documents, and is idempotent and tenant scoped`, async () => {
      const org = await createTestOrg();
      const other = await createTestOrg();
      try {
        const fixture = async (orgId: string, label: string, scenario: 'full' | 'partial' | 'draft-doc' | 'refund' | 'pending-note' | 'void-note' | 'overdue') => {
          const amount = scenario === 'partial' ? 40 : 100;
          const status = scenario === 'pending-note' ? 'PENDING_APPROVAL' : scenario === 'void-note' ? 'VOID' : 'APPLIED';
          if (kind === 'ar') {
            const customerId = await createCustomer(orgId);
            const doc = await prisma.salesInvoice.create({ data: { organizationId: orgId, customerId, number: label, issueDate: date,
              status: scenario === 'draft-doc' ? 'DRAFT' : scenario === 'overdue' ? 'OVERDUE' : 'SENT', subtotal: 100, totalAmount: 100 } });
            await prisma.creditNote.create({ data: { organizationId: orgId, customerId, number: label, date, sourceInvoiceId: doc.id,
              status, amount, settlementType: scenario === 'refund' ? 'REFUND' : 'APPLY_TO_INVOICE' } });
            return doc.id;
          }
          const vendorId = await createVendor(orgId);
          const doc = await prisma.bill.create({ data: { organizationId: orgId, vendorId, number: label, issueDate: date,
            status: scenario === 'draft-doc' ? 'DRAFT' : scenario === 'overdue' ? 'OVERDUE' : 'OPEN', subtotal: 100, totalAmount: 100 } });
          await prisma.debitNote.create({ data: { organizationId: orgId, vendorId, number: label, date, sourceBillId: doc.id,
            status, amount, settlementType: scenario === 'refund' ? 'REFUND_FROM_VENDOR' : 'APPLY_TO_BILL' } });
          return doc.id;
        };
        const full = await fixture(org.orgId, 'full', 'full');
        const overdue = await fixture(org.orgId, 'overdue', 'overdue');
        const excluded = [];
        for (const scenario of ['partial', 'draft-doc', 'refund', 'pending-note', 'void-note'] as const) {
          excluded.push(await fixture(org.orgId, scenario, scenario));
        }
        const foreign = await fixture(other.orgId, 'other', 'full');
        const documents = () => kind === 'ar'
          ? prisma.salesInvoice.findMany({ where: { organizationId: org.orgId }, orderBy: { id: 'asc' } })
          : prisma.bill.findMany({ where: { organizationId: org.orgId }, orderBy: { id: 'asc' } });
        const statusOf = async (id: string) => kind === 'ar'
          ? (await prisma.salesInvoice.findUniqueOrThrow({ where: { id } })).status
          : (await prisma.bill.findUniqueOrThrow({ where: { id } })).status;
        const notes = () => kind === 'ar'
          ? prisma.creditNote.findMany({ where: { organizationId: org.orgId }, orderBy: { id: 'asc' } })
          : prisma.debitNote.findMany({ where: { organizationId: org.orgId }, orderBy: { id: 'asc' } });
        const before = await documents();
        const notesBefore = await notes();
        const key = kind === 'ar' ? 'invoices' : 'bills';
        expect((await backfillNoteSettlementStatus(prisma, { organizationId: org.orgId }))[key]).toEqual({ scanned: 3, paid: 2 });
        expect(await documents()).toEqual(before); // Includes updatedAt: dry run persists nothing.
        expect((await backfillNoteSettlementStatus(prisma, { apply: true, organizationId: org.orgId }))[key]).toEqual({ scanned: 3, paid: 2 });
        expect(await statusOf(full)).toBe('PAID');
        expect(await statusOf(overdue)).toBe('PAID');
        for (const id of excluded) expect(await statusOf(id)).toBe(before.find(doc => doc.id === id)?.status);
        expect(await statusOf(foreign)).toBe(kind === 'ar' ? 'SENT' : 'OPEN');
        expect((await backfillNoteSettlementStatus(prisma, { apply: true, organizationId: org.orgId }))[key]).toEqual({ scanned: 1, paid: 0 });
        expect(await notes()).toEqual(notesBefore);
        expect(await prisma.journalEntry.count({ where: { organizationId: org.orgId } })).toBe(0);
        expect(await prisma.aRPayment.count({ where: { organizationId: org.orgId } })).toBe(0);
        expect(await prisma.aPPayment.count({ where: { organizationId: org.orgId } })).toBe(0);
      } finally {
        await cleanupOrg(org.orgId);
        await cleanupOrg(other.orgId);
      }
    });
  }
});
