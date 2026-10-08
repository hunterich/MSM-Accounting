import { NextRequest } from 'next/server';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, requireOrg } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { runDueRecurringBills } from '@/lib/recurring-bills';

export const runtime = 'nodejs';
export async function OPTIONS() { return corsPreflightResponse(); }
export const POST = withPermission({ module: 'AP_BILLS', action: 'create' }, async (req: NextRequest) =>
  ok(await runDueRecurringBills(requireOrg(req), req.headers.get('x-user-id'))));
