import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { err, withHandler } from '@/lib/api-utils';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { prisma } from '@/lib/prisma';
import { getSettings } from '@/lib/backup/backup-service';

export const runtime = 'nodejs';

export function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (req.headers.get('x-role-type') !== 'ADMIN') return err('Forbidden: ADMIN role required', 403);
  const { id } = await params;
  const record = await prisma.backupRecord.findUnique({ where: { id } });
  if (!record || record.fileName === '(failed)') return err('Backup file not found', 404);

  const settings = await getSettings();
  const filePath = path.join(settings.canonicalDirResolved, record.fileName);
  let buf: Buffer;
  try {
    buf = await fs.readFile(filePath);
  } catch {
    return err('Backup file is no longer on disk', 410);
  }
  return withCors(new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${record.fileName}"`,
      'x-filename': record.fileName,
    },
  }));
});
