import type { Prisma, PrismaClient } from '@prisma/client';
import { advisoryLockKey } from './advisory-lock';
import { logAuditTx } from './api-utils';
import { dateInTimezone, purchaseOrderIsDue, autoCloseDate } from './purchase-order-auto-close-config';

/** Same transaction lock as receiving: closing must not race a receipt. */
export async function lockPurchaseOrder(tx: Prisma.TransactionClient, id: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${advisoryLockKey(`po-receive:${id}`)})`;
}

export async function autoClosePurchaseOrder(tx: Prisma.TransactionClient, orgId: string, id: string, now = new Date()): Promise<boolean> {
  await lockPurchaseOrder(tx, id);
  const po = await tx.purchaseOrder.findFirst({
    where: { id, organizationId: orgId },
    include: { organization: { select: { timezone: true } } },
  });
  if (!po || !purchaseOrderIsDue(po, dateInTimezone(now, po.organization.timezone || 'Asia/Jakarta'))) return false;
  const closed = await tx.purchaseOrder.updateMany({
    where: { id, organizationId: orgId, status: { in: ['APPROVED', 'PARTIAL_RECEIVED'] },
      autoCloseEnabled: true, expectedDate: po.expectedDate, autoCloseDays: po.autoCloseDays },
    data: { status: 'CLOSED', autoClosedAt: now },
  });
  if (closed.count !== 1) return false;
  await logAuditTx(tx, {
    orgId, actorId: null, entityType: 'PurchaseOrder', entityId: id, action: 'UPDATE',
    payload: { action: 'auto_close', previousStatus: po.status, expectedDate: po.expectedDate?.toISOString(),
      autoCloseDays: po.autoCloseDays, deadline: autoCloseDate(po.expectedDate, po.autoCloseDays) },
  });
  return true;
}

/** Runs on backend startup and every 15 minutes; each close is atomic + audited. */
export async function closeDuePurchaseOrders(db: PrismaClient, now = new Date()): Promise<number> {
  const candidates = await db.purchaseOrder.findMany({
    where: { autoCloseEnabled: true, status: { in: ['APPROVED', 'PARTIAL_RECEIVED'] }, expectedDate: { not: null } },
    select: { id: true, organizationId: true },
  });
  let closed = 0;
  for (const po of candidates) {
    try {
      if (await db.$transaction((tx) => autoClosePurchaseOrder(tx, po.organizationId, po.id, now))) closed++;
    } catch (error) {
      console.error(`[purchase-order-auto-close] failed for ${po.id}:`, error);
    }
  }
  return closed;
}
