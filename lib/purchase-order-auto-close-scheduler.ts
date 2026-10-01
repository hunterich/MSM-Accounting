import cron, { type ScheduledTask } from 'node-cron';
import { prisma } from './prisma';
import { closeDuePurchaseOrders } from './purchase-order-auto-close';

const state = globalThis as typeof globalThis & { purchaseOrderAutoCloseTask?: ScheduledTask; purchaseOrderAutoCloseRunning?: boolean };
export async function initPurchaseOrderAutoCloseScheduler(): Promise<void> {
  if (state.purchaseOrderAutoCloseTask) return;
  const run = async () => {
    if (state.purchaseOrderAutoCloseRunning) return;
    state.purchaseOrderAutoCloseRunning = true;
    try { await closeDuePurchaseOrders(prisma); }
    catch (error) { console.error('[purchase-order-auto-close] sweep failed:', error); }
    finally { state.purchaseOrderAutoCloseRunning = false; }
  };
  state.purchaseOrderAutoCloseTask = cron.schedule('*/15 * * * *', () => { void run(); });
  await run();
}
