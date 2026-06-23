import { NextRequest } from 'next/server';
import { ok, err, withHandler } from '@/lib/api-utils';
import { corsPreflightResponse } from '@/lib/cors';
import { createBackup } from '@/lib/backup/backup-service';

export const runtime = 'nodejs';

export function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withHandler(async function POST(req: NextRequest) {
  if (req.headers.get('x-role-type') !== 'ADMIN') return err('Forbidden: ADMIN role required', 403);
  const userId = req.headers.get('x-user-id');
  const result = await createBackup({ type: 'MANUAL', triggeredByUserId: userId });
  return ok(result, 201);
});
