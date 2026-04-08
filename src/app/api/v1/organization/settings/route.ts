import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { logAudit } from '@/lib/api-utils';
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

export async function GET(req: NextRequest) {
  try {
    const orgId = req.headers.get('x-org-id');
    if (!orgId) {
      return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));
    }

    const organization = await prisma.organization.findUnique({
      where: { id: orgId },
    }) as unknown as OrganizationSettingsRecord | null;

    if (!organization) {
      return withCors(NextResponse.json({ error: 'Organization not found' }, { status: 404 }));
    }

    return withCors(
      NextResponse.json({
        ...organization,
        needsInventoryValuationSetup: !organization.costingMethod,
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load organization settings';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export async function PUT(req: NextRequest) {
  try {
    const orgId = req.headers.get('x-org-id');
    const userId = req.headers.get('x-user-id');
    if (!orgId) {
      return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));
    }

    const body = await req.json();
    const parsed = updateOrganizationSettingsInputSchema.safeParse({
      ...body,
      costingMethod: typeof body.costingMethod === 'string' ? String(body.costingMethod).trim().toUpperCase() : body.costingMethod,
    });
    if (!parsed.success) {
      return withCors(NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid organization settings payload' }, { status: 400 }));
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
      return withCors(NextResponse.json({ error: 'No changes provided' }, { status: 400 }));
    }

    if (parsed.data.invoiceReminders || parsed.data.paymentAlerts || parsed.data.dailySummary) {
      if (!String(updateData.financeEmail || '').trim()) {
        return withCors(NextResponse.json({ error: 'Finance notification email is required when notifications are enabled' }, { status: 400 }));
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

    return withCors(
      NextResponse.json({
        ...updated,
        needsInventoryValuationSetup: !updated.costingMethod,
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update organization settings';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}
