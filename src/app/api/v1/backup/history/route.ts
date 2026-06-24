import { NextRequest } from 'next/server';
import { err, listResponse, withHandler, parsePaginationParams } from '@/lib/api-utils';
import { corsPreflightResponse } from '@/lib/cors';
import { listBackups } from '@/lib/backup/backup-service';

export const runtime = 'nodejs';

export function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  if (req.headers.get('x-role-type') !== 'ADMIN') return err('Forbidden: ADMIN role required', 403);
  const { page, limit } = parsePaginationParams(req, { limit: 20, maxLimit: 100 });
  const { data, total } = await listBackups(page, limit);
  return listResponse(data, total, page, limit);
});
