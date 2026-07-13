import { NextRequest } from 'next/server';
import { corsPreflightResponse } from '@/lib/cors';
import { requireOrg, ok } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { commitBatch } from '@/lib/migration/commit';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withPermission(
  { module: 'SETTINGS', action: 'create' },
  async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const orgId = requireOrg(req);
    const { id } = await params;
    // A failing reconcile returns { committed:false, reconcile } — still a 200 so
    // the UI can render which checks failed. Only unexpected errors surface as 5xx.
    const result = await commitBatch(orgId, id, null);
    return ok(result);
  },
);
