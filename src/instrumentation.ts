export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initBackupScheduler } = await import('@/lib/backup/scheduler');
    await initBackupScheduler();
    const { initPurchaseOrderAutoCloseScheduler } = await import('@/lib/purchase-order-auto-close-scheduler');
    await initPurchaseOrderAutoCloseScheduler();
  }
}
