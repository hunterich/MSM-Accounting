import type { Prisma, PrismaClient } from '@prisma/client';
import { advisoryLockKey } from './advisory-lock';
import { logAuditTx } from './api-utils';
import { ApiError } from './errors';
import { autoCloseDeadline, autoCloseStartDate, dateInTimezone, purchaseOrderIsDue } from './purchase-order-auto-close-config';

const DEFAULT_TIMEZONE = 'Asia/Jakarta';

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
  if (!po) return false;
  const timezone = po.organization.timezone || DEFAULT_TIMEZONE;
  if (!purchaseOrderIsDue(po, dateInTimezone(now, timezone), timezone)) return false;
  // Claim the close only if the schedule read above is still current.
  const closed = await tx.purchaseOrder.updateMany({
    where: { id, organizationId: orgId, status: { in: ['APPROVED', 'PARTIAL_RECEIVED'] },
      autoCloseEnabled: true, date: po.date, reopenedAt: po.reopenedAt, autoCloseDays: po.autoCloseDays },
    data: { status: 'CLOSED', autoClosedAt: now },
  });
  if (closed.count !== 1) return false;
  await logAuditTx(tx, {
    orgId, actorId: null, entityType: 'PurchaseOrder', entityId: id, action: 'UPDATE',
    payload: { action: 'auto_close', previousStatus: po.status, startDate: autoCloseStartDate(po, timezone),
      reopenedAt: po.reopenedAt?.toISOString() ?? null, autoCloseDays: po.autoCloseDays, deadline: autoCloseDeadline(po, timezone) },
  });
  return true;
}

/** Runs on backend startup and every 15 minutes; each close is atomic + audited. */
export async function closeDuePurchaseOrders(db: PrismaClient, now = new Date()): Promise<number> {
  const candidates = await db.purchaseOrder.findMany({
    where: { autoCloseEnabled: true, status: { in: ['APPROVED', 'PARTIAL_RECEIVED'] } },
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

const QTY_TOLERANCE = 0.0001;

/**
 * Reopen a closed PO so its undelivered balance can be received again.
 * Restores APPROVED or PARTIAL_RECEIVED from the received quantities and
 * restarts the auto-close period from today's company date.
 */
export async function reopenPurchaseOrder(
  tx: Prisma.TransactionClient, orgId: string, id: string, actorId: string | null, now = new Date(),
) {
  await lockPurchaseOrder(tx, id);
  const po = await tx.purchaseOrder.findFirst({
    where: { id, organizationId: orgId },
    include: { organization: { select: { timezone: true } }, lines: { select: { quantity: true, receivedQty: true } } },
  });
  if (!po) throw new ApiError('Purchase order not found', 404);
  if (po.status !== 'CLOSED') throw new ApiError('Only a closed purchase order can be reopened', 422);
  const remaining = po.lines.some((line) => Number(line.receivedQty) < Number(line.quantity) - QTY_TOLERANCE);
  if (!remaining) throw new ApiError('Every ordered quantity has been received; there is nothing to reopen', 422);

  const anyReceived = po.lines.some((line) => Number(line.receivedQty) > QTY_TOLERANCE);
  const status = anyReceived ? 'PARTIAL_RECEIVED' : 'APPROVED';
  const updated = await tx.purchaseOrder.update({
    where: { id, organizationId: orgId },
    data: { status, reopenedAt: now, autoClosedAt: null },
  });
  const timezone = po.organization.timezone || DEFAULT_TIMEZONE;
  await logAuditTx(tx, {
    orgId, actorId, entityType: 'PurchaseOrder', entityId: id, action: 'UPDATE',
    payload: { action: 'reopen', previousStatus: po.status, status,
      previousAutoClosedAt: po.autoClosedAt?.toISOString() ?? null,
      autoCloseEnabled: po.autoCloseEnabled, autoCloseDays: po.autoCloseDays,
      deadline: po.autoCloseEnabled ? autoCloseDeadline({ ...po, reopenedAt: now }, timezone) : null },
  });
  return updated;
}
