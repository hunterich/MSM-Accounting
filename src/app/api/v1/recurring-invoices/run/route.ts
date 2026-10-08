import { NextRequest } from 'next/server';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, requireOrg } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { runDueRecurringInvoices } from '@/lib/recurring-invoices';

export const runtime = 'nodejs';
export async function OPTIONS() { return corsPreflightResponse(); }
export const POST = withPermission({ module: 'AR_INVOICES', action: 'create' }, async (req: NextRequest) =>
  ok(await runDueRecurringInvoices(requireOrg(req), req.headers.get('x-user-id'))));
