import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma, createTestOrg, createCustomer, createVendor, cleanupOrg, disconnect, journalEntryCount, assertTrialBalanced } from './harness';
import { approveRequest, rejectRequest } from '@/lib/approval/engine';

afterAll(disconnect);
const DATE = new Date('2026-04-10T00:00:00.000Z');

describe('note approval recovery', () => {
  for (const kind of ['ar', 'ap'] as const) {
    it(`${kind}: concurrent approval and rejection leave one consistent terminal outcome`, async () => {
      const org = await createTestOrg();
      try {
        const role = await prisma.role.create({ data: { organizationId: org.orgId, name: 'Approver', roleType: 'ADMIN' } });
        const user = await prisma.user.create({ data: { email: `${randomUUID()}@test.local`, fullName: 'Approver', passwordHash: 'x', status: 'ACTIVE' } });
        await prisma.userOrganization.create({ data: { userId: user.id, organizationId: org.orgId, roleId: role.id } });
        const actor = { orgId: org.orgId, userId: user.id, roleType: 'ADMIN' };
        const partyId = kind === 'ar' ? await createCustomer(org.orgId) : await createVendor(org.orgId);
        const source = kind === 'ar'
          ? await prisma.salesInvoice.create({ data: { organizationId: org.orgId, number: 'INV-RECOVERY', customerId: partyId, issueDate: DATE, status: 'SENT', subtotal: 100, totalAmount: 100 } })
          : await prisma.bill.create({ data: { organizationId: org.orgId, number: 'BILL-RECOVERY', vendorId: partyId, issueDate: DATE, status: 'OPEN', subtotal: 100, totalAmount: 100 } });
        const note = kind === 'ar'
          ? await prisma.creditNote.create({ data: { organizationId: org.orgId, customerId: partyId, sourceInvoiceId: source.id, number: 'CN-RECOVERY', date: DATE, amount: 100, status: 'PENDING_APPROVAL', settlementType: 'APPLY_TO_INVOICE' } })
          : await prisma.debitNote.create({ data: { organizationId: org.orgId, vendorId: partyId, sourceBillId: source.id, number: 'DN-RECOVERY', date: DATE, amount: 100, status: 'PENDING_APPROVAL', settlementType: 'APPLY_TO_BILL' } });
        const request = await prisma.approvalRequest.create({ data: { organizationId: org.orgId, documentType: kind === 'ar' ? 'CREDIT_NOTE' : 'DEBIT_NOTE', documentId: note.id, requestedById: user.id } });
        const outcomes = await Promise.allSettled([approveRequest(request.id, actor), rejectRequest(request.id, actor, 'Revise note')]);
        expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        const rejected = outcomes.find(result => result.status === 'rejected');
        expect(rejected?.status === 'rejected' && [400, 409].includes(rejected.reason.status)).toBe(true);
        const finalRequest = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: request.id } });
        const finalNote = kind === 'ar' ? await prisma.creditNote.findUniqueOrThrow({ where: { id: note.id } })
          : await prisma.debitNote.findUniqueOrThrow({ where: { id: note.id } });
        const approved = finalRequest.status === 'APPROVED';
        expect(finalRequest.status).toBe(approved ? 'APPROVED' : 'REJECTED');
        expect(finalNote.status).toBe(approved ? 'APPLIED' : 'DRAFT');
        expect(Boolean(finalNote.journalEntryId)).toBe(approved);
        expect(await journalEntryCount(org.orgId)).toBe(approved ? 1 : 0);
        await assertTrialBalanced(org.orgId, 'after competing note decisions');
      } finally { await cleanupOrg(org.orgId); }
    });
  }
});
