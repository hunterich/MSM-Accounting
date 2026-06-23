import { NextRequest } from 'next/server';
import { ok, err, withHandler } from '@/lib/api-utils';
import { corsPreflightResponse } from '@/lib/cors';
import { restoreBackup } from '@/lib/backup/backup-service';
import { restoreBackupInputSchema } from '@/types/api';

export const runtime = 'nodejs';

export function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withHandler(async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (req.headers.get('x-role-type') !== 'ADMIN') return err('Forbidden: ADMIN role required', 403);
  const body = await req.json().catch(() => ({}));
  const parsed = restoreBackupInputSchema.safeParse(body);
  if (!parsed.success) return err('You must type RESTORE to confirm.', 400);

  const { id } = await params;
  const userId = req.headers.get('x-user-id');
  const result = await restoreBackup({ recordId: id, triggeredByUserId: userId });
  return ok(result);
});
