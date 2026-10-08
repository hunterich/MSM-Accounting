export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.BACKGROUND_JOBS_ENABLED !== 'false' && process.env.NEXT_PHASE !== 'phase-production-build') {
    const { initBackupScheduler } = await import('@/lib/backup/scheduler');
    await initBackupScheduler();
    const { initPurchaseOrderAutoCloseScheduler } = await import('@/lib/purchase-order-auto-close-scheduler');
    await initPurchaseOrderAutoCloseScheduler();
    const { initBusinessAutomationScheduler } = await import('@/lib/business-automation-scheduler');
    await initBusinessAutomationScheduler();
  }
}
