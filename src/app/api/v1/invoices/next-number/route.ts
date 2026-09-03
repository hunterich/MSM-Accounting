// GET /api/v1/invoices/next-number[?issueDate=YYYY-MM-DD] → { number }
// The number the next invoice would be given, per the org's numbering
// settings, for the form's "Auto" preview. A hint only: the save allocates
// under the org's sequence lock, so a concurrent save may take this number.
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { err, ok, requireOrg } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { peekNextInvoiceNumber } from '@/lib/invoice-number';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withPermission({ module: 'AR_INVOICES', action: 'view' }, async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const raw = req.nextUrl.searchParams.get('issueDate');
  let issueDate: Date | undefined;
  if (raw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return err('issueDate must be YYYY-MM-DD', 400);
    issueDate = new Date(`${raw}T00:00:00.000Z`);
    if (Number.isNaN(issueDate.getTime())) return err('issueDate is not a valid date', 400);
  }
  const number = await peekNextInvoiceNumber(prisma, orgId, { issueDate });
  return ok({ number });
});
