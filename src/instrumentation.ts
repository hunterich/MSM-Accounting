export async function register() {
  // Refuse to serve production traffic with a guessable session secret (SEC-02):
  // whoever knows it can sign in as any user. lib/auth.ts also refuses per
  // request, so this is the loud, early half of a fail-closed check.
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NODE_ENV === 'production' && process.env.NEXT_PHASE !== 'phase-production-build') {
    const { jwtSecretProblem } = await import('@/lib/auth');
    const problem = jwtSecretProblem(process.env.JWT_SECRET);
    if (problem) {
      console.error(`[security] Refusing to start: ${problem}`);
      throw new Error(problem);
    }
  }
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.BACKGROUND_JOBS_ENABLED !== 'false' && process.env.NEXT_PHASE !== 'phase-production-build') {
    const { initBackupScheduler } = await import('@/lib/backup/scheduler');
    await initBackupScheduler();
    const { initPurchaseOrderAutoCloseScheduler } = await import('@/lib/purchase-order-auto-close-scheduler');
    await initPurchaseOrderAutoCloseScheduler();
    const { initBusinessAutomationScheduler } = await import('@/lib/business-automation-scheduler');
    await initBusinessAutomationScheduler();
  }
}
