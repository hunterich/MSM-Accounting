import { NextRequest } from 'next/server';
import { ok, err } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { corsPreflightResponse } from '@/lib/cors';
import { restoreBackup } from '@/lib/backup/backup-service';
import { restoreBackupInputSchema } from '@/types/api';

export const runtime = 'nodejs';

export function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withPermission(
  { module: 'SYSTEM_BACKUP', action: 'create' },
  async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) {
  const body = await req.json().catch(() => ({}));
  const parsed = restoreBackupInputSchema.safeParse(body);
  if (!parsed.success) return err('You must type RESTORE to confirm.', 400);

  const { id } = await params;
  const userId = req.headers.get('x-user-id');
  const result = await restoreBackup({ recordId: id, triggeredByUserId: userId });
  return ok(result);
});
