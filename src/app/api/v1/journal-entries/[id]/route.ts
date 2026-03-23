import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, err, logAudit } from '@/lib/api-utils';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  const entry = await prisma.journalEntry.findFirst({
    where: { id, organizationId: orgId },
    include: {
      lines: { include: { account: { select: { code: true, name: true } } } },
    },
  });
  if (!entry) return err('Not found', 404);
  return ok(entry);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  const body = await req.json();
  const { lines, ...header } = body;
  // Only allow editing DRAFT entries — scope check to org
  const existing = await prisma.journalEntry.findFirst({ where: { id, organizationId: orgId } });
  if (!existing) return err('Not found', 404);
  if (existing.status !== 'DRAFT') return err('Only DRAFT entries can be edited', 400);
  const updated = await prisma.$transaction(async (tx) => {
    await tx.journalEntry.update({
      where: { id, organizationId: orgId },
      data: { ...header, updatedAt: new Date() },
    });
    if (lines) {
      await tx.journalLine.deleteMany({ where: { entryId: id } });
      await tx.journalLine.createMany({
        data: lines.map((l: { lineNo?: number; [key: string]: unknown }, idx: number) => ({
          ...l,
          entryId: id,
          lineNo: l.lineNo ?? idx + 1,
        })),
      });
    }
    return tx.journalEntry.findFirst({
      where: { id, organizationId: orgId },
      include: { lines: { include: { account: { select: { code: true, name: true } } } } },
    });
  });
  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'JournalEntry', entityId: id, action: 'UPDATE', payload: body });
  return ok(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  const existing = await prisma.journalEntry.findFirst({ where: { id, organizationId: orgId } });
  if (!existing) return err('Not found', 404);
  if (existing.status !== 'DRAFT') return err('Only DRAFT entries can be deleted', 400);
  await prisma.journalEntry.delete({ where: { id, organizationId: orgId } });
  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'JournalEntry', entityId: id, action: 'DELETE', payload: null });
  return ok({ deleted: true });
}
