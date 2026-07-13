import { NextRequest } from 'next/server';
import { corsPreflightResponse } from '@/lib/cors';
import { requireOrg, ok } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { rollbackBatch } from '@/lib/migration/rollback';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withPermission(
  { module: 'SETTINGS', action: 'create' },
  async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const orgId = requireOrg(req);
    const { id } = await params;
    const result = await rollbackBatch(orgId, id);
    return ok(result);
  },
);
