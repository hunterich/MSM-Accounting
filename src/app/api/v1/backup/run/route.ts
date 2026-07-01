import { NextRequest } from 'next/server';
import { ok } from '@/lib/api-utils';
import { withPlatformAdmin } from '@/lib/authz';
import { corsPreflightResponse } from '@/lib/cors';
import { createBackup } from '@/lib/backup/backup-service';

export const runtime = 'nodejs';

export function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withPlatformAdmin(async function POST(req: NextRequest) {
  const userId = req.headers.get('x-user-id');
  const result = await createBackup({ type: 'MANUAL', triggeredByUserId: userId });
  return ok(result, 201);
});
