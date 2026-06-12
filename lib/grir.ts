import type { Prisma } from '@prisma/client';
import { loadOrgAccountDefaults } from './account-defaults';

const GRIR_CODE = '2150';
const GRIR_NAME = 'Goods Received Not Invoiced';

/**
 * Resolve the org's GR/IR clearing account id, creating it if absent.
 * Resolution order: configured `grIrClearing` default → existing account by
 * code 2150 → create a postable LIABILITY account. Idempotent. Never falls
 * back to an arbitrary liability (which could be AP).
 */
export async function ensureGrIrAccount(
  tx: Prisma.TransactionClient,
  orgId: string,
): Promise<string> {
  // 1. Explicitly configured default
  const settings = await loadOrgAccountDefaults(tx, orgId);
  const configuredId = settings.grIrClearing;
  if (configuredId) {
    const configured = await tx.account.findFirst({
      where: { id: configuredId, organizationId: orgId, isActive: true, isPostable: true, type: 'LIABILITY' },
      select: { id: true },
    });
    if (configured) return configured.id;
  }

  // 2. Existing account by code
  const byCode = await tx.account.findFirst({
    where: { organizationId: orgId, code: GRIR_CODE },
    select: { id: true },
  });
  if (byCode) return byCode.id;

  // 3. Create it
  const created = await tx.account.create({
    data: {
      organizationId: orgId,
      code: GRIR_CODE,
      name: GRIR_NAME,
      type: 'LIABILITY',
      normalSide: 'CREDIT',
      isActive: true,
      isPostable: true,
    },
    select: { id: true },
  });
  return created.id;
}
