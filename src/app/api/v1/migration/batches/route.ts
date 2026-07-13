import { NextRequest } from 'next/server';
import { corsPreflightResponse } from '@/lib/cors';
import { requireOrg, ok, ApiError } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { createBatch, listBatches } from '@/lib/migration/batch-service';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withPermission(
  { module: 'SETTINGS', action: 'create' },
  async function POST(req: NextRequest) {
    const orgId = requireOrg(req);
    const body = (await req.json()) as { cutoverDate?: string };
    if (!body.cutoverDate) throw new ApiError('cutoverDate is required', 400);
    const cutoverDate = new Date(body.cutoverDate);
    if (Number.isNaN(cutoverDate.getTime())) {
      throw new ApiError('cutoverDate is not a valid date', 400);
    }
    const batch = await createBatch(orgId, cutoverDate, null);
    return ok(batch);
  },
);

export const GET = withPermission(
  { module: 'SETTINGS', action: 'view' },
  async function GET(req: NextRequest) {
    const orgId = requireOrg(req);
    return ok(await listBatches(orgId));
  },
);
