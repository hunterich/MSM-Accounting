import { NextRequest } from 'next/server';
import { corsPreflightResponse } from '@/lib/cors';
import { requireOrg, ok, ApiError } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { getBatch } from '@/lib/migration/batch-service';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withPermission(
  { module: 'SETTINGS', action: 'view' },
  async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const orgId = requireOrg(req);
    const { id } = await params;
    const batch = await getBatch(orgId, id);
    if (!batch) throw new ApiError('Batch not found', 404);
    return ok(batch);
  },
);
