import { NextRequest } from 'next/server';
import { listResponse, parsePaginationParams } from '@/lib/api-utils';
import { withPlatformAdmin } from '@/lib/authz';
import { corsPreflightResponse } from '@/lib/cors';
import { listBackups } from '@/lib/backup/backup-service';

export const runtime = 'nodejs';

export function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withPlatformAdmin(async function GET(req: NextRequest) {
  const { page, limit } = parsePaginationParams(req, { limit: 20, maxLimit: 100 });
  const { data, total } = await listBackups(page, limit);
  return listResponse(data, total, page, limit);
});
