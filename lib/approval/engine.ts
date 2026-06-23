import type { ApprovalDocumentType, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';
import { logAuditTx } from '@/lib/api-utils';
import { normalizeApprovalRequirements, requiresApproval } from './config';
import { getDescriptor } from './registry';
import { getFinalizer } from './finalizers';
import { assertApprovalAuthorized } from './can-approve';

/**
 * Decide whether finalizing should be held for approval.
 * Returns true if it routed (caller must STOP and set its holding status);
 * false if no approval is needed / already granted (caller proceeds to finalize).
 */
export async function routeForApproval(
  tx: Prisma.TransactionClient,
  args: { orgId: string; userId: string; documentType: ApprovalDocumentType; documentId: string },
): Promise<boolean> {
  const org = await tx.organization.findUnique({
    where: { id: args.orgId },
    select: { approvalRequirements: true },
  });
  const reqs = normalizeApprovalRequirements(org?.approvalRequirements);
  const { configKey } = getDescriptor(args.documentType);
  if (!requiresApproval(reqs, configKey)) return false;

  const alreadyApproved = await tx.approvalRequest.findFirst({
    where: { organizationId: args.orgId, documentType: args.documentType, documentId: args.documentId, status: 'APPROVED' },
    select: { id: true },
  });
  if (alreadyApproved) return false; // approver path: let the finalize proceed

  const open = await tx.approvalRequest.findFirst({
    where: { organizationId: args.orgId, documentType: args.documentType, documentId: args.documentId, status: 'PENDING' },
    select: { id: true },
  });
  if (!open) {
    await tx.approvalRequest.create({
      data: {
        organizationId: args.orgId,
        documentType: args.documentType,
        documentId: args.documentId,
        requestedById: args.userId,
        requestedAt: new Date(),
        status: 'PENDING',
      },
    });
  }
  return true;
}

/** Approve a pending request: authorize, run the finalizer, mark APPROVED. */
export async function approveRequest(
  approvalRequestId: string,
  actor: { orgId: string; userId: string; roleType: string },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const reqRow = await tx.approvalRequest.findFirst({
      where: { id: approvalRequestId, organizationId: actor.orgId },
      select: { id: true, documentType: true, documentId: true, requestedById: true, status: true },
    });
    if (!reqRow) throw new ApiError('Approval request not found', 404);
    if (reqRow.status !== 'PENDING') throw new ApiError(`Approval request is ${reqRow.status}, not PENDING`, 400);

    const org = await tx.organization.findUnique({
      where: { id: actor.orgId },
      select: { requireDistinctApproverForAdmins: true },
    });
    const { moduleKey } = getDescriptor(reqRow.documentType);
    await assertApprovalAuthorized(tx, {
      orgId: actor.orgId,
      userId: actor.userId,
      roleType: actor.roleType,
      moduleKey,
      requestedById: reqRow.requestedById,
      requireDistinctApproverForAdmins: org?.requireDistinctApproverForAdmins ?? false,
    });

    await getFinalizer(reqRow.documentType)(tx, actor.orgId, reqRow.documentId);

    await tx.approvalRequest.update({
      where: { id: reqRow.id },
      data: { status: 'APPROVED', reviewedById: actor.userId, reviewedAt: new Date() },
    });
    await logAuditTx(tx, {
      orgId: actor.orgId,
      actorId: actor.userId,
      entityType: 'ApprovalRequest',
      entityId: reqRow.id,
      action: 'UPDATE',
      payload: { action: 'approve', documentType: reqRow.documentType, documentId: reqRow.documentId },
    });
  });
}

/** Reject a pending request: revert the document to DRAFT, mark REJECTED with a note. */
export async function rejectRequest(
  approvalRequestId: string,
  actor: { orgId: string; userId: string; roleType: string },
  note?: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const reqRow = await tx.approvalRequest.findFirst({
      where: { id: approvalRequestId, organizationId: actor.orgId },
      select: { id: true, documentType: true, documentId: true, requestedById: true, status: true },
    });
    if (!reqRow) throw new ApiError('Approval request not found', 404);
    if (reqRow.status !== 'PENDING') throw new ApiError(`Approval request is ${reqRow.status}, not PENDING`, 400);

    const org = await tx.organization.findUnique({
      where: { id: actor.orgId },
      select: { requireDistinctApproverForAdmins: true },
    });
    const { moduleKey } = getDescriptor(reqRow.documentType);
    await assertApprovalAuthorized(tx, {
      orgId: actor.orgId,
      userId: actor.userId,
      roleType: actor.roleType,
      moduleKey,
      requestedById: reqRow.requestedById,
      requireDistinctApproverForAdmins: org?.requireDistinctApproverForAdmins ?? false,
    });

    const revertMap: Record<ApprovalDocumentType, () => Promise<unknown>> = {
      INVOICE:         () => tx.salesInvoice.update({ where: { id: reqRow.documentId }, data: { status: 'DRAFT',    updatedAt: new Date() } }),
      PURCHASE_ORDER:  () => tx.purchaseOrder.update({ where: { id: reqRow.documentId }, data: { status: 'DRAFT',    updatedAt: new Date() } }),
      BILL:            () => tx.bill.update({ where: { id: reqRow.documentId }, data: { status: 'DRAFT',    updatedAt: new Date() } }),
      SALES_ORDER:     () => tx.salesOrder.update({ where: { id: reqRow.documentId }, data: { status: 'DRAFT',    updatedAt: new Date() } }),
      PAYROLL_RUN:     () => tx.payrollRun.update({ where: { id: reqRow.documentId }, data: { status: 'REVIEWED', updatedAt: new Date() } }),
      CREDIT_NOTE:     () => tx.creditNote.update({ where: { id: reqRow.documentId }, data: { status: 'DRAFT',    updatedAt: new Date() } }),
      DEBIT_NOTE:      () => tx.debitNote.update({ where: { id: reqRow.documentId }, data: { status: 'DRAFT',    updatedAt: new Date() } }),
      SALES_RETURN:    () => tx.salesReturn.update({ where: { id: reqRow.documentId }, data: { status: 'DRAFT',    updatedAt: new Date() } }),
      PURCHASE_RETURN:  () => tx.purchaseReturn.update({ where: { id: reqRow.documentId }, data: { status: 'DRAFT',    updatedAt: new Date() } }),
      AR_PAYMENT:       () => tx.aRPayment.update({ where: { id: reqRow.documentId }, data: { status: 'DRAFT',    updatedAt: new Date() } }),
      AP_PAYMENT:       () => tx.aPPayment.update({ where: { id: reqRow.documentId }, data: { status: 'DRAFT',    updatedAt: new Date() } }),
      STOCK_ADJUSTMENT: () => tx.stockAdjustment.update({ where: { id: reqRow.documentId }, data: { status: 'DRAFT',    updatedAt: new Date() } }),
    };
    await revertMap[reqRow.documentType]();

    await tx.approvalRequest.update({
      where: { id: reqRow.id },
      data: { status: 'REJECTED', reviewedById: actor.userId, reviewedAt: new Date(), ...(note ? { note } : {}) },
    });
    await logAuditTx(tx, {
      orgId: actor.orgId,
      actorId: actor.userId,
      entityType: 'ApprovalRequest',
      entityId: reqRow.id,
      action: 'UPDATE',
      payload: { action: 'reject', documentType: reqRow.documentType, documentId: reqRow.documentId, note },
    });
  });
}
