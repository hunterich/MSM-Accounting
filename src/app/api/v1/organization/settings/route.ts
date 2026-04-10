import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { withHandler, requireOrg, ok, err, logAudit } from '@/lib/api-utils';
import { updateOrganizationSettingsInputSchema } from '@/types/api';

export const runtime = 'nodejs';

type OrganizationSettingsRecord = {
  id: string;
  legalName: string;
  displayName: string;
  npwp: string | null;
  isPkp: boolean;
  baseCurrency: string;
  fiscalYearStart: Date | null;
  costingMethod: string | null;
  costingMethodSetAt: Date | null;
  costingMethodSetById: string | null;
  costingMethodEffectiveDate: Date | null;
};

const toDateOrNull = (value: unknown): Date | null => {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = requireOrg(req);

  const organization = await prisma.organization.findUnique({
    where: { id: orgId },
  }) as unknown as OrganizationSettingsRecord | null;

  if (!organization) {
    return err('Organization not found', 404);
  }

  return ok({
    ...organization,
    needsInventoryValuationSetup: !organization.costingMethod,
  });
});

export const PUT = withHandler(async function PUT(req: NextRequest) {
  const orgId = requireOrg(req);
  const userId = req.headers.get('x-user-id');

  const body = await req.json();
  const parsed = updateOrganizationSettingsInputSchema.safeParse({
    ...body,
    costingMethod: typeof body.costingMethod === 'string' ? String(body.costingMethod).trim().toUpperCase() : body.costingMethod,
  });
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message || 'Invalid organization settings payload', 400);
  }
  const updateData: Record<string, unknown> = {};

  if (parsed.data.legalName !== undefined) updateData.legalName = parsed.data.legalName;
  if (parsed.data.displayName !== undefined) updateData.displayName = parsed.data.displayName;
  if (parsed.data.npwp !== undefined) updateData.npwp = parsed.data.npwp?.trim() || null;
  if (parsed.data.isPkp !== undefined) updateData.isPkp = parsed.data.isPkp;
  if (parsed.data.baseCurrency !== undefined) updateData.baseCurrency = parsed.data.baseCurrency;
  if (parsed.data.timezone !== undefined) updateData.timezone = parsed.data.timezone;
  if (parsed.data.locale !== undefined) updateData.locale = parsed.data.locale;
  if (parsed.data.defaultCreditLimit !== undefined) updateData.defaultCreditLimit = parsed.data.defaultCreditLimit;
  if (parsed.data.enforceCreditLimit !== undefined) updateData.enforceCreditLimit = parsed.data.enforceCreditLimit;
  if (parsed.data.taxEnabled !== undefined) updateData.taxEnabled = parsed.data.taxEnabled;
  if (parsed.data.taxDefaultRate !== undefined) updateData.taxDefaultRate = parsed.data.taxDefaultRate;
  if (parsed.data.taxInclusiveByDefault !== undefined) updateData.taxInclusiveByDefault = parsed.data.taxInclusiveByDefault;
  if (parsed.data.financeEmail !== undefined) updateData.financeEmail = parsed.data.financeEmail?.trim() || null;
  if (parsed.data.invoiceReminders !== undefined) updateData.invoiceReminders = parsed.data.invoiceReminders;
  if (parsed.data.paymentAlerts !== undefined) updateData.paymentAlerts = parsed.data.paymentAlerts;
  if (parsed.data.dailySummary !== undefined) updateData.dailySummary = parsed.data.dailySummary;

  if (parsed.data.fiscalYearStart !== undefined) {
    updateData.fiscalYearStart = toDateOrNull(parsed.data.fiscalYearStart);
  }

  if (parsed.data.costingMethod !== undefined) {
    updateData.costingMethod = parsed.data.costingMethod;
    updateData.costingMethodSetAt = new Date();
    updateData.costingMethodSetById = userId || null;

    const effectiveDate = toDateOrNull(parsed.data.costingMethodEffectiveDate)
      ?? toDateOrNull(parsed.data.fiscalYearStart)
      ?? new Date();
    updateData.costingMethodEffectiveDate = effectiveDate;
  } else if (parsed.data.costingMethodEffectiveDate !== undefined) {
    updateData.costingMethodEffectiveDate = toDateOrNull(parsed.data.costingMethodEffectiveDate);
  }

  if (Object.keys(updateData).length === 0) {
    return err('No changes provided', 400);
  }

  if (parsed.data.invoiceReminders || parsed.data.paymentAlerts || parsed.data.dailySummary) {
    if (!String(updateData.financeEmail || '').trim()) {
      return err('Finance notification email is required when notifications are enabled', 400);
    }
  }

  const updated = await prisma.organization.update({
    where: { id: orgId },
    data: updateData,
  }) as unknown as OrganizationSettingsRecord;

  logAudit({
    orgId,
    actorId: userId,
    entityType: 'Organization',
    entityId: updated.id,
    action: 'UPDATE',
    payload: updateData,
  });

  return ok({
    ...updated,
    needsInventoryValuationSetup: !updated.costingMethod,
  });
});
