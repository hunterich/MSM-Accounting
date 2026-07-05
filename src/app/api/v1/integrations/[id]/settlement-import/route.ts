import { NextRequest } from 'next/server';
import { corsPreflightResponse } from '@/lib/cors';
import { requireAuth, ok, err } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { settlementImportInputSchema } from '@/types/api';
import { importSettlement } from '@/lib/settlement-import';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withPermission(
  { module: 'AR_INVOICES', action: 'create' },
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { orgId, userId } = requireAuth(req);
    const { id } = await params;
    const parsed = settlementImportInputSchema.safeParse(await req.json());
    if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid settlement payload', 400);
    const result = await importSettlement(orgId, userId, id, parsed.data);
    return ok(result, 200);
  },
);
