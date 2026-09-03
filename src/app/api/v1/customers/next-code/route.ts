// GET /api/v1/customers/next-code?prefix=CST → { code: 'CST-0042' }
// The next free customer code for a prefix, computed over the whole org (the
// form used to derive it from its first page of customers and collided).
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { err, ok, requireOrg, withHandler } from '@/lib/api-utils';
import {
  DEFAULT_CUSTOMER_CODE_PREFIX,
  isValidCustomerCodePrefix,
  nextCustomerCode,
} from '@/lib/customer-code';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const prefix = (req.nextUrl.searchParams.get('prefix') || DEFAULT_CUSTOMER_CODE_PREFIX).trim();
  if (!isValidCustomerCodePrefix(prefix)) {
    return err('prefix must be 1-10 letters or digits', 400);
  }
  const code = await nextCustomerCode(prisma, orgId, prefix);
  return ok({ prefix, code });
});
