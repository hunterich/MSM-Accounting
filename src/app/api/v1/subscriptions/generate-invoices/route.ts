import { NextRequest } from 'next/server';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, requireOrg } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { runDueSubscriptions } from '@/lib/subscription-billing';

export const runtime = 'nodejs';
export async function OPTIONS() { return corsPreflightResponse(); }
export const POST = withPermission({ module: 'SETTINGS', action: 'create' }, async (req: NextRequest) =>
  ok(await runDueSubscriptions(requireOrg(req), req.headers.get('x-user-id'))));
