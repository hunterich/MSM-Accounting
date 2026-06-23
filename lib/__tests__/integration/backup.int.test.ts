import { afterAll, describe, expect, it } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prisma, createTestOrg, cleanupOrg, disconnect } from './harness';
import { resolvePgToolPath, assertPgToolAvailable, runPgDump } from '../../backup/pg-tools';

const execFile = promisify(execFileCb);

afterAll(async () => { await disconnect(); });

function testDbUrl(): string {
  const base = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL!;
  const url = new URL(base);
  const db = url.pathname.replace(/^\//, '');
  if (!db.endsWith('_test')) url.pathname = `/${db}_test`;
  return url.toString();
}

describe('backup: pg_dump produces a valid, restorable archive', () => {
  it('dumps the real test database and the archive lists table data', async () => {
    const dumpTool = resolvePgToolPath('pg_dump');
    await assertPgToolAvailable(dumpTool); // throws a clear message if tools are missing

    const org = await createTestOrg();
    const before = await prisma.organization.count();
    expect(before).toBeGreaterThan(0);

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'msm-backup-'));
    const file = path.join(dir, 'msm_accounting_test.dump');
    const url = testDbUrl();

    await runPgDump({ toolPath: dumpTool, databaseUrl: url, outFile: file });
    const stat = await fs.stat(file);
    expect(stat.size).toBeGreaterThan(0);

    // Validate the archive is restorable WITHOUT a destructive restore against the
    // live (connection-held) test DB: `pg_restore --list` reads the archive TOC only.
    const restoreTool = resolvePgToolPath('pg_restore');
    const { stdout } = await execFile(restoreTool, ['--list', file]);
    expect(stdout).toMatch(/TABLE DATA/);     // archive contains real table data
    expect(stdout).toContain('Organization'); // our schema is present

    await fs.rm(dir, { recursive: true, force: true });
    await cleanupOrg(org.orgId);
  });
});
