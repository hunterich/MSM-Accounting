import { afterAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as commitApi } from '@/src/app/api/v1/migration/batches/[id]/commit/route';
import { POST as stageApi } from '@/src/app/api/v1/migration/batches/[id]/stage/route';
import { POST as createJournalApi } from '@/src/app/api/v1/journal-entries/route';
import { advisoryLockKey } from '@/lib/advisory-lock';
import { createBatch, stageEntity } from '@/lib/migration/batch-service';
import { commitBatch, resolveControlCodes } from '@/lib/migration/commit';
import { rollbackBatch, rollbackBatchInTransaction } from '@/lib/migration/rollback';
import { postStockAdjustmentToLedger } from '@/lib/stock-adjustment-posting';
import { postJournalEntry } from '@/lib/journal-posting';
import { closeAccountingPeriod } from '@/lib/period-close';
import { prisma, createTestOrg, cleanupOrg, disconnect, accountBalance, assertTrialBalanced } from './harness';

afterAll(disconnect);
const CUTOVER = new Date('2026-01-01');
function signal<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function waiting(fragment: string, minimum = 1) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE ${`%${fragment}%`}`;
    if (rows[0].count >= minimum) return;
    await new Promise(done => setTimeout(done, 10));
  }
  throw new Error(`No verified database lock wait for ${fragment}`);
}
async function prepared() {
  const org = await createTestOrg();
  const batch = await createBatch(org.orgId, CUTOVER, null), codes = await resolveControlCodes(org.orgId);
  await stageEntity(org.orgId, batch.id, 'customers', [{ name: 'PT Andi' }]);
  await stageEntity(org.orgId, batch.id, 'items', [{ name: 'Free stock', sku: 'FREE', type: 'PRODUCT', openingStock: 5, openingValue: 0 }]);
  await stageEntity(org.orgId, batch.id, 'opening-journal', [
    { accountCode: codes.AR, debit: 1000, credit: 0 }, { accountCode: codes.OPENING_EQUITY, debit: 0, credit: 1000 },
  ]);
  await stageEntity(org.orgId, batch.id, 'opening-invoices', [{ customerName: 'PT Andi', amount: 1000, issueDate: '2025-12-01' }]);
  return { org, batch };
}
type F = Awaited<ReturnType<typeof prepared>>;
async function snapshot(f: F) {
  const where = { organizationId: f.org.orgId };
  return { batch: await prisma.migrationBatch.findUniqueOrThrow({ where: { id: f.batch.id } }),
    items: await prisma.item.findMany({ where, orderBy: { id: 'asc' } }),
    lots: await prisma.inventoryLot.findMany({ where, orderBy: { id: 'asc' } }),
    movements: await prisma.inventoryLedgerEntry.findMany({ where, orderBy: { id: 'asc' } }),
    invoices: await prisma.salesInvoice.findMany({ where, orderBy: { id: 'asc' } }),
    journals: await prisma.journalEntry.findMany({ where, orderBy: { id: 'asc' }, include: { lines: { orderBy: { id: 'asc' } } } }),
  };
}
describe('migration state and live stock overlap', () => {
  it('the real manual journal API waits on migration numbering and both entries commit distinctly', async () => {
    const f = await prepared(), ready = signal<void>(), release = signal<void>();
    let gateResult: Promise<unknown> | undefined, commitResult: Promise<any> | undefined, manualResult: Promise<any> | undefined;
    try {
      const user = await prisma.user.create({ data: { email: `${f.org.orgId}-numbering@test.local`, fullName: 'Poster', passwordHash: 'x', status: 'ACTIVE' } });
      const gate = prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${advisoryLockKey(`je-seq:${f.org.orgId}`)})`;
        ready.resolve(); await release.promise;
      }, { timeout: 15000 });
      gateResult = gate.then(() => null, error => error);
      await Promise.race([ready.promise, gate.then(() => { throw new Error('Numbering gate did not wait'); })]);
      commitResult = commitBatch(f.org.orgId, f.batch.id, null).then(value => value, error => error);
      await waiting('pg_advisory_xact_lock');
      const req = new NextRequest('http://localhost/api/v1/journal-entries', { method: 'POST', headers: {
        'x-org-id': f.org.orgId, 'x-user-id': user.id, 'x-role-type': 'ADMIN', 'content-type': 'application/json',
      }, body: JSON.stringify({ date: '2026-01-02', memo: 'Live manual expense', source: 'MANUAL', status: 'POSTED',
        lines: [{ accountId: f.org.accounts.inventoryAdjustment, debit: 100, credit: 0 }, { accountId: f.org.accounts.bankAsset, debit: 0, credit: 100 }] }) });
      manualResult = createJournalApi(req).then(value => value, error => error);
      await waiting('pg_advisory_xact_lock', 2); release.resolve();
      expect(await gateResult).toBeNull(); expect(await commitResult).toMatchObject({ committed: true });
      const response = await manualResult; expect(response.status).toBe(201);
      const state = await snapshot(f); expect(state.journals.map(entry => entry.entryNo).sort()).toEqual(['JE-000001', 'JE-000002']);
      expect(await accountBalance(f.org.orgId, f.org.accounts.arControl)).toBe(1000);
      expect(await accountBalance(f.org.orgId, f.org.accounts.bankAsset)).toBe(-100);
      await assertTrialBalanced(f.org.orgId);
    } finally { release.resolve(); if (gateResult) await gateResult; if (commitResult) await commitResult; if (manualResult) await manualResult; await cleanupOrg(f.org.orgId); }
  });
  it('a closed cutover month refuses rollback with an unchanged opening ledger and stock', async () => {
    const f = await prepared();
    try {
      await commitBatch(f.org.orgId, f.batch.id, null);
      await prisma.accountingPeriod.create({ data: { organizationId: f.org.orgId, name: 'January', startDate: CUTOVER,
        endDate: new Date('2026-01-31T23:59:59Z'), status: 'CLOSED', isLocked: true } });
      const before = await snapshot(f);
      await expect(rollbackBatch(f.org.orgId, f.batch.id)).rejects.toMatchObject({ status: 422 });
      expect(await snapshot(f)).toEqual(before);
    } finally { await cleanupOrg(f.org.orgId); }
  });

  for (const closeFirst of [true, false]) it(`period close versus rollback: ${closeFirst ? 'close' : 'rollback'} wins with a verified lock wait`, async () => {
    const f = await prepared(), ready = signal<void>(), release = signal<void>();
    let firstResult: Promise<unknown> | undefined, secondResult: Promise<any> | undefined;
    try {
      await commitBatch(f.org.orgId, f.batch.id, null);
      const period = await prisma.accountingPeriod.create({ data: { organizationId: f.org.orgId, name: 'January', startDate: CUTOVER,
        endDate: new Date('2026-01-31T23:59:59Z'), status: 'OPEN' } });
      const user = await prisma.user.create({ data: { email: `${f.org.orgId}@test.local`, fullName: 'Closer', passwordHash: 'x', status: 'ACTIVE' } });
      const first = prisma.$transaction(async tx => {
        if (closeFirst) await closeAccountingPeriod(tx, f.org.orgId, user.id, period.id);
        else expect((await rollbackBatchInTransaction(tx, f.org.orgId, f.batch.id)).rolledBack).toBe(true);
        ready.resolve(); await release.promise;
      }, { isolationLevel: closeFirst ? 'ReadCommitted' : 'Serializable', timeout: 15000 });
      firstResult = first.then(() => null, error => error);
      await Promise.race([ready.promise, first.then(() => { throw new Error('First operation did not wait'); })]);
      const second = closeFirst ? rollbackBatch(f.org.orgId, f.batch.id)
        : prisma.$transaction(tx => closeAccountingPeriod(tx, f.org.orgId, user.id, period.id), { timeout: 15000 });
      secondResult = second.then(value => value, error => error);
      await waiting('AccountingPeriod'); release.resolve(); expect(await firstResult).toBeNull();
      const outcome = await secondResult;
      if (closeFirst) expect(outcome).toMatchObject({ status: 422 });
      else expect(outcome.status).toBe('CLOSED');
      const state = await snapshot(f);
      expect(state.batch.status).toBe(closeFirst ? 'COMMITTED' : 'ROLLED_BACK');
      expect(state.journals).toHaveLength(closeFirst ? 1 : 0); expect(state.lots).toHaveLength(closeFirst ? 1 : 0);
      expect(await accountBalance(f.org.orgId, f.org.accounts.arControl)).toBe(closeFirst ? 1000 : 0);
      expect((await prisma.accountingPeriod.findUniqueOrThrow({ where: { id: period.id } })).status).toBe('CLOSED');
    } finally { release.resolve(); if (firstResult) await firstResult; if (secondResult) await secondResult; await cleanupOrg(f.org.orgId); }
  });
  it('live journal and migration opening serialize their numbering without collisions or lost postings', async () => {
    const f = await prepared(), ready = signal<void>(), release = signal<void>();
    let postingResult: Promise<unknown> | undefined, commitResult: Promise<any> | undefined;
    try {
      const posting = prisma.$transaction(async tx => {
        await postJournalEntry(tx, { organizationId: f.org.orgId, date: new Date('2026-01-02'), memo: 'Live expense',
          lines: [{ accountId: f.org.accounts.inventoryAdjustment, description: 'Expense', debit: 100, credit: 0 },
            { accountId: f.org.accounts.bankAsset, description: 'Cash', debit: 0, credit: 100 }] });
        ready.resolve(); await release.promise;
      }, { timeout: 15000 });
      postingResult = posting.then(() => null, error => error);
      await Promise.race([ready.promise, posting.then(() => { throw new Error('Posting did not wait'); })]);
      commitResult = commitBatch(f.org.orgId, f.batch.id, null).then(value => value, error => error);
      await waiting('pg_advisory_xact_lock'); release.resolve();
      expect(await postingResult).toBeNull(); expect(await commitResult).toMatchObject({ committed: true });
      const state = await snapshot(f); expect(state.journals.map(entry => entry.entryNo).sort()).toEqual(['JE-000001', 'JE-000002']);
      expect(await accountBalance(f.org.orgId, f.org.accounts.arControl)).toBe(1000);
      expect(await accountBalance(f.org.orgId, f.org.accounts.bankAsset)).toBe(-100);
      expect(await accountBalance(f.org.orgId, f.org.accounts.inventoryAdjustment)).toBe(100);
      await assertTrialBalanced(f.org.orgId);
    } finally { release.resolve(); if (postingResult) await postingResult; if (commitResult) await commitResult; await cleanupOrg(f.org.orgId); }
  });
  it('commit and staging APIs return 409 for a committed batch instead of a server error', async () => {
    const f = await prepared();
    try {
      await commitBatch(f.org.orgId, f.batch.id, null);
      const before = await snapshot(f);
      const req = (body: unknown) => new NextRequest('http://localhost/api/v1/migration', { method: 'POST', headers: {
        'x-org-id': f.org.orgId, 'x-user-id': 'finance-reviewer', 'x-role-type': 'ADMIN', 'content-type': 'application/json',
      }, body: JSON.stringify(body) });
      const params = { params: Promise.resolve({ id: f.batch.id }) };
      expect((await commitApi(req({}), params)).status).toBe(409);
      expect((await stageApi(req({ entity: 'customers', rows: [{ name: 'Stale edit' }] }), params)).status).toBe(409);
      expect(await snapshot(f)).toEqual(before);
    } finally { await cleanupOrg(f.org.orgId); }
  });
  it('zero-value stock activity blocks rollback without deleting any imported record', async () => {
    const f = await prepared();
    try {
      await commitBatch(f.org.orgId, f.batch.id, null);
      const item = await prisma.item.findFirstOrThrow({ where: { organizationId: f.org.orgId, sku: 'FREE' } });
      await prisma.$transaction(tx => postStockAdjustmentToLedger(tx, f.org.orgId, { id: 'ZERO', number: 'ZERO', date: new Date('2026-01-02'), warehouseId: null,
        lines: [{ itemId: item.id, oldQty: 5, newQty: 4, unitCost: 0 }] }));
      const before = await snapshot(f);
      expect(before.journals).toHaveLength(1);
      expect(await rollbackBatch(f.org.orgId, f.batch.id)).toMatchObject({ rolledBack: false });
      expect(await snapshot(f)).toEqual(before);
      expect(await accountBalance(f.org.orgId, f.org.accounts.arControl)).toBe(1000);
    } finally { await cleanupOrg(f.org.orgId); }
  });

  it('live stock wins: actual rollback service retries its stale snapshot and leaves exact stock and GL intact', async () => {
    const f = await prepared(), ready = signal<void>(), release = signal<void>();
    let settledStock: Promise<unknown> | undefined, settledRollback: Promise<unknown> | undefined;
    try {
      await commitBatch(f.org.orgId, f.batch.id, null);
      const item = await prisma.item.findFirstOrThrow({ where: { organizationId: f.org.orgId, sku: 'FREE' } });
      const stock = prisma.$transaction(async tx => {
        await postStockAdjustmentToLedger(tx, f.org.orgId, { id: 'ZERO-RACE', number: 'ZERO-RACE', date: new Date('2026-01-02'), warehouseId: null,
          lines: [{ itemId: item.id, oldQty: 5, newQty: 4, unitCost: 0 }] });
        ready.resolve(); await release.promise;
      }, { timeout: 15000 });
      settledStock = stock.then(() => null, error => error);
      await Promise.race([ready.promise, stock.then(() => { throw new Error('Stock transaction did not wait'); })]);
      settledRollback = rollbackBatch(f.org.orgId, f.batch.id).then(value => value, error => error);
      // The inbound-link FK can make rollback wait during ledger deletion
      // before it reaches lot deletion. Both waits protect this same stock.
      await waiting('Inventory'); release.resolve();
      expect(await settledStock).toBeNull(); expect(await settledRollback).toMatchObject({ rolledBack: false });
      const state = await snapshot(f);
      expect(state.batch.status).toBe('COMMITTED'); expect(state.items).toHaveLength(1); expect(state.invoices).toHaveLength(1);
      expect(state.lots.map(lot => Number(lot.qtyBalance))).toEqual([4]);
      expect(state.movements.reduce((sum, row) => sum + Number(row.qtyIn) - Number(row.qtyOut), 0)).toBe(4);
      expect(state.journals).toHaveLength(1); expect(await accountBalance(f.org.orgId, f.org.accounts.arControl)).toBe(1000);
      await assertTrialBalanced(f.org.orgId);
    } finally { release.resolve(); if (settledStock) await settledStock; if (settledRollback) await settledRollback; await cleanupOrg(f.org.orgId); }
  });

  it('rollback wins: a waiting stale stock movement refuses and writes no replacement ledger or journal', async () => {
    const f = await prepared(), ready = signal<void>(), release = signal<void>();
    let settledRollback: Promise<unknown> | undefined, settledStock: Promise<unknown> | undefined;
    try {
      await commitBatch(f.org.orgId, f.batch.id, null);
      const item = await prisma.item.findFirstOrThrow({ where: { organizationId: f.org.orgId, sku: 'FREE' } });
      const rollback = prisma.$transaction(async tx => { const result = await rollbackBatchInTransaction(tx, f.org.orgId, f.batch.id);
        expect(result.rolledBack).toBe(true); ready.resolve(); await release.promise; }, { isolationLevel: 'Serializable', timeout: 15000 });
      settledRollback = rollback.then(() => null, error => error);
      await Promise.race([ready.promise, rollback.then(() => { throw new Error('Rollback transaction did not wait'); })]);
      const stock = prisma.$transaction(tx => postStockAdjustmentToLedger(tx, f.org.orgId, { id: 'STALE', number: 'STALE', date: new Date('2026-01-02'), warehouseId: null,
        lines: [{ itemId: item.id, oldQty: 5, newQty: 4, unitCost: 0 }] }), { timeout: 15000 });
      settledStock = stock.then(() => null, error => error);
      await waiting('InventoryLot'); release.resolve();
      expect(await settledRollback).toBeNull(); expect(await settledStock).toBeInstanceOf(Error);
      const state = await snapshot(f);
      expect(state.batch.status).toBe('ROLLED_BACK'); expect(state.items).toEqual([]); expect(state.lots).toEqual([]);
      expect(state.movements).toEqual([]); expect(state.invoices).toEqual([]); expect(state.journals).toEqual([]);
      expect(await accountBalance(f.org.orgId, f.org.accounts.arControl)).toBe(0);
    } finally { release.resolve(); if (settledRollback) await settledRollback; if (settledStock) await settledStock; await cleanupOrg(f.org.orgId); }
  });

  it('staging after a lock wait merges the latest JSON instead of discarding another entity', async () => {
    const f = await prepared(), ready = signal<void>(), release = signal<void>();
    let firstResult: Promise<unknown> | undefined, secondResult: Promise<unknown> | undefined;
    try {
      const first = prisma.$transaction(async tx => {
        const current = await tx.migrationBatch.findUniqueOrThrow({ where: { id: f.batch.id } });
        await tx.migrationBatch.update({ where: { id: f.batch.id }, data: { stagedData: { ...(current.stagedData as object), customers: [{ name: 'Latest customer' }] } } });
        ready.resolve(); await release.promise;
      }, { timeout: 15000 });
      firstResult = first.then(() => null, error => error);
      await Promise.race([ready.promise, first.then(() => { throw new Error('First staging update did not wait'); })]);
      secondResult = stageEntity(f.org.orgId, f.batch.id, 'vendors', [{ name: 'New vendor' }]).then(value => value, error => error);
      await waiting('MigrationBatch'); release.resolve();
      expect(await firstResult).toBeNull(); expect(await secondResult).toMatchObject({ staged: 1 });
      const batch = await prisma.migrationBatch.findUniqueOrThrow({ where: { id: f.batch.id } });
      const staged = batch.stagedData as { customers: Array<{ name: string }>; vendors: Array<{ name: string }> };
      expect(staged.customers[0].name).toBe('Latest customer'); expect(staged.vendors[0].name).toBe('New vendor');
    } finally { release.resolve(); if (firstResult) await firstResult; if (secondResult) await secondResult; await cleanupOrg(f.org.orgId); }
  });

  it('commit refuses a changed staged snapshot after waiting, preserving the edit and creating no opening records', async () => {
    const f = await prepared(), ready = signal<void>(), release = signal<void>();
    let gateResult: Promise<unknown> | undefined, commitResult: Promise<unknown> | undefined;
    try {
      const gate = prisma.$transaction(async tx => { await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${f.org.orgId} FOR UPDATE`;
        ready.resolve(); await release.promise; }, { timeout: 15000 });
      gateResult = gate.then(() => null, error => error);
      await Promise.race([ready.promise, gate.then(() => { throw new Error('Company gate did not wait'); })]);
      commitResult = commitBatch(f.org.orgId, f.batch.id, null).then(value => value, error => error);
      await waiting('Organization');
      await stageEntity(f.org.orgId, f.batch.id, 'customers', [{ name: 'PT Andi', email: 'edited@test.local' }]);
      release.resolve(); expect(await gateResult).toBeNull(); expect(await commitResult).toMatchObject({ status: 409 });
      const state = await snapshot(f); expect(state.batch.status).toBe('DRAFT'); expect(state.items).toEqual([]);
      expect(state.lots).toEqual([]); expect(state.invoices).toEqual([]); expect(state.journals).toEqual([]);
    } finally { release.resolve(); if (gateResult) await gateResult; if (commitResult) await commitResult; await cleanupOrg(f.org.orgId); }
  });

  it('concurrent commits serialize before writing; one succeeds and the other reports a stale status', async () => {
    const f = await prepared(), ready = signal<void>(), release = signal<void>();
    let gateResult: Promise<unknown> | undefined, a: Promise<any> | undefined, b: Promise<any> | undefined;
    try {
      const gate = prisma.$transaction(async tx => { await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${f.org.orgId} FOR UPDATE`;
        ready.resolve(); await release.promise; }, { timeout: 15000 });
      gateResult = gate.then(() => null, error => error);
      await Promise.race([ready.promise, gate.then(() => { throw new Error('Company gate did not wait'); })]);
      a = commitBatch(f.org.orgId, f.batch.id, null).then(value => value, error => error);
      b = commitBatch(f.org.orgId, f.batch.id, null).then(value => value, error => error);
      await waiting('Organization', 2); release.resolve(); expect(await gateResult).toBeNull();
      const results = [await a, await b];
      expect(results.filter(result => result.committed === true)).toHaveLength(1);
      expect(results.find(result => result.status === 409)?.message).toContain('COMMITTED');
      const state = await snapshot(f); expect(state.batch.status).toBe('COMMITTED');
      expect(state.items).toHaveLength(1); expect(state.lots).toHaveLength(1); expect(state.movements).toHaveLength(1);
      expect(state.invoices).toHaveLength(1); expect(state.journals).toHaveLength(1);
      expect(await accountBalance(f.org.orgId, f.org.accounts.arControl)).toBe(1000);
    } finally { release.resolve(); if (gateResult) await gateResult; if (a) await a; if (b) await b; await cleanupOrg(f.org.orgId); }
  });

  it('commit re-runs reconciliation with the account defaults that changed while it waited', async () => {
    const f = await prepared(), ready = signal<void>(), release = signal<void>();
    let gateResult: Promise<unknown> | undefined, commitResult: Promise<any> | undefined;
    try {
      const account = await prisma.account.create({ data: { organizationId: f.org.orgId, code: '1999', name: 'New AR Control', type: 'ASSET', normalSide: 'DEBIT' } });
      const gate = prisma.$transaction(async tx => {
        await tx.organization.update({ where: { id: f.org.orgId }, data: { accountDefaults: { arControl: account.id } } });
        ready.resolve(); await release.promise;
      }, { timeout: 15000 });
      gateResult = gate.then(() => null, error => error);
      await Promise.race([ready.promise, gate.then(() => { throw new Error('Defaults update did not wait'); })]);
      commitResult = commitBatch(f.org.orgId, f.batch.id, null).then(value => value, error => error);
      await waiting('Organization'); release.resolve(); expect(await gateResult).toBeNull();
      expect(await commitResult).toMatchObject({ committed: false, reconcile: { ok: false } });
      const state = await snapshot(f); expect(state.batch.status).toBe('DRAFT');
      expect(state.items).toEqual([]); expect(state.invoices).toEqual([]); expect(state.journals).toEqual([]);
      expect((await prisma.organization.findUniqueOrThrow({ where: { id: f.org.orgId } })).accountDefaults).toEqual({ arControl: account.id });
    } finally { release.resolve(); if (gateResult) await gateResult; if (commitResult) await commitResult; await cleanupOrg(f.org.orgId); }
  });
});
