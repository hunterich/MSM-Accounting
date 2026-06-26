import type { Prisma } from '@prisma/client';
import { loadOrgAccountDefaults } from './account-defaults';

const PPH_PAYABLE_CODE = '2160';
const PPH_PAYABLE_NAME = 'PPh Withholding Payable';

/**
 * Resolve the org's PPh-withholding payable account id, creating it if absent.
 * Resolution order: configured `pphPayable` default → existing account by code
 * 2160 → create a postable LIABILITY account. Idempotent. Never falls back to
 * an arbitrary liability (which could be AP or output-tax payable) — withholding
 * must land in its own liability so it can be remitted to the tax office.
 */
export async function ensurePphPayableAccount(
  tx: Prisma.TransactionClient,
  orgId: string,
): Promise<string> {
  // 1. Explicitly configured default
  const settings = await loadOrgAccountDefaults(tx, orgId);
  const configuredId = settings.pphPayable;
  if (configuredId) {
    const configured = await tx.account.findFirst({
      where: { id: configuredId, organizationId: orgId, isActive: true, isPostable: true, type: 'LIABILITY' },
      select: { id: true },
    });
    if (configured) return configured.id;
  }

  // 2. Existing account by code
  const byCode = await tx.account.findFirst({
    where: { organizationId: orgId, code: PPH_PAYABLE_CODE },
    select: { id: true },
  });
  if (byCode) return byCode.id;

  // 3. Create it
  const created = await tx.account.create({
    data: {
      organizationId: orgId,
      code: PPH_PAYABLE_CODE,
      name: PPH_PAYABLE_NAME,
      type: 'LIABILITY',
      normalSide: 'CREDIT',
      isActive: true,
      isPostable: true,
    },
    select: { id: true },
  });
  return created.id;
}
