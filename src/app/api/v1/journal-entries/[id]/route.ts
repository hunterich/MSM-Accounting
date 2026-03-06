// @ts-nocheck
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, err } from '@/lib/api-utils';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entry = await prisma.journalEntry.findUnique({
    where: { id: id },
    include: {
      lines: { include: { account: { select: { code: true, name: true } } } },
    },
  });
  if (!entry) return err('Not found', 404);
  return ok(entry);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id');
  const body = await req.json();
  const { lines, ...header } = body;
  // Only allow editing DRAFT entries
  const existing = await prisma.journalEntry.findUnique({ where: { id: id } });
  if (!existing) return err('Not found', 404);
  if (existing.status !== 'DRAFT') return err('Only DRAFT entries can be edited', 400);
  const updated = await prisma.$transaction(async (tx) => {
    await tx.journalEntry.update({
      where: { id: id, organizationId: orgId },
      data: { ...header, updatedAt: new Date() },
    });
    if (lines) {
      await tx.journalLine.deleteMany({ where: { entryId: id } });
      await tx.journalLine.createMany({
        data: lines.map((l: any, idx: number) => ({
          ...l,
          entryId: id,
          lineNo: l.lineNo ?? idx + 1,
        })),
      });
    }
    return tx.journalEntry.findUnique({
      where: { id: id },
      include: { lines: { include: { account: { select: { code: true, name: true } } } } },
    });
  });
  return ok(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = _req.headers.get('x-org-id');
  const existing = await prisma.journalEntry.findUnique({ where: { id: id } });
  if (!existing) return err('Not found', 404);
  if (existing.status !== 'DRAFT') return err('Only DRAFT entries can be deleted', 400);
  await prisma.journalEntry.delete({ where: { id: id, organizationId: orgId } });
  return ok({ deleted: true });
}
