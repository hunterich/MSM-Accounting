import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { logAudit } from '@/lib/api-utils';

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
    }) as OrganizationSettingsRecord | null;

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
    const updateData: Record<string, unknown> = {};

    if (typeof body.legalName === 'string') updateData.legalName = body.legalName.trim();
    if (typeof body.displayName === 'string') updateData.displayName = body.displayName.trim();
    if (typeof body.npwp === 'string') updateData.npwp = body.npwp.trim() || null;
    if (typeof body.isPkp === 'boolean') updateData.isPkp = body.isPkp;
    if (typeof body.baseCurrency === 'string') updateData.baseCurrency = body.baseCurrency.trim() || 'IDR';

    if (body.fiscalYearStart !== undefined) {
      const fiscalYearStart = toDateOrNull(body.fiscalYearStart);
      if (body.fiscalYearStart && !fiscalYearStart) {
        return withCors(NextResponse.json({ error: 'Invalid fiscalYearStart' }, { status: 400 }));
      }
      updateData.fiscalYearStart = fiscalYearStart;
    }

    if (body.costingMethod !== undefined) {
      if (body.costingMethod !== 'FIFO' && body.costingMethod !== 'WEIGHTED_AVERAGE') {
        return withCors(NextResponse.json({ error: 'Invalid costingMethod' }, { status: 400 }));
      }
      updateData.costingMethod = body.costingMethod;
      updateData.costingMethodSetAt = new Date();
      updateData.costingMethodSetById = userId || null;

      const effectiveDate = toDateOrNull(body.costingMethodEffectiveDate)
        ?? toDateOrNull(body.fiscalYearStart)
        ?? new Date();
      updateData.costingMethodEffectiveDate = effectiveDate;
    }

    if (Object.keys(updateData).length === 0) {
      return withCors(NextResponse.json({ error: 'No changes provided' }, { status: 400 }));
    }

    if (
      Object.prototype.hasOwnProperty.call(updateData, 'legalName')
      && !String(updateData.legalName || '').trim()
    ) {
      return withCors(NextResponse.json({ error: 'Legal company name is required' }, { status: 400 }));
    }

    if (
      Object.prototype.hasOwnProperty.call(updateData, 'displayName')
      && !String(updateData.displayName || '').trim()
    ) {
      return withCors(NextResponse.json({ error: 'Display name is required' }, { status: 400 }));
    }

    const updated = await prisma.organization.update({
      where: { id: orgId },
      data: updateData,
    }) as OrganizationSettingsRecord;

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
