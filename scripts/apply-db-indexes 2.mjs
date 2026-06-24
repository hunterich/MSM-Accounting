#!/usr/bin/env node
// Apply indexes Prisma's schema cannot express (partial / filtered unique indexes).
//
// `prisma db push` will NEVER create these, so they must be applied out-of-band on
// every fresh database (prod, a reset dev DB, a teammate's clone). The seed script
// (prisma/seed.ts → applyRawIndexes) applies the same statements, so a `db push` +
// reseed already covers you; run THIS script when you need the indexes on an existing
// DB WITHOUT wiping data (e.g. production).
//
// Usage:  npm run db:indexes            (reads DATABASE_URL from .env)
//         DATABASE_URL=... npm run db:indexes
//
// Idempotent (IF NOT EXISTS) — safe to run repeatedly.

import { PrismaClient } from '@prisma/client';

const INDEXES = [
  {
    name: 'ApprovalRequest_open_pending_unique',
    // Bug-A backstop: at most one OPEN (PENDING) ApprovalRequest per (org, docType, doc).
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "ApprovalRequest_open_pending_unique"
          ON "ApprovalRequest" ("organizationId", "documentType", "documentId")
          WHERE status = 'PENDING';`,
  },
];

const prisma = new PrismaClient();

try {
  for (const idx of INDEXES) {
    await prisma.$executeRawUnsafe(idx.sql);
    console.log(`✓ applied ${idx.name}`);
  }
  console.log(`Done. ${INDEXES.length} index(es) ensured.`);
} catch (err) {
  console.error('Failed to apply indexes:', err);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
