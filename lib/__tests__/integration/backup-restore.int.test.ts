import { afterAll, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { prisma, createTestOrg, createVendor, cleanupOrg, disconnect } from './harness'
import { postBillToLedger } from '../../bill-posting'
import { postApPaymentIfNeeded } from '../../payment-posting'
import { syncApPaymentSettlement } from '../../settlement-status'
import { resolvePgToolPath, runPgDump, runPgRestore } from '../../backup/pg-tools'

const execFile = promisify(execFileCallback)
afterAll(disconnect)

it('restores a backup into a fresh separate database with exact documents, allocations and journal lines', async () => {
  const sourceUrl = new URL(process.env.DATABASE_URL!)
  if (!sourceUrl.pathname.endsWith('_test')) throw new Error('Backup restore verification requires a disposable _test source')
  const targetName = `msm_restore_${randomUUID().replaceAll('-', '')}_test`
  if (!/^msm_restore_[a-f0-9]{32}_test$/.test(targetName)) throw new Error('Unsafe restore database name')
  const targetUrl = new URL(sourceUrl)
  targetUrl.pathname = `/${targetName}`
  const target = new PrismaClient({ datasources: { db: { url: targetUrl.toString() } } })
  const org = await createTestOrg()
  const vendorId = await createVendor(org.orgId)
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'msm-restore-check-'))
  const file = path.join(dir, 'backup.dump')
  const docker = process.env.QA_DOCKER_PATH
  const container = process.env.QA_POSTGRES_CONTAINER
  const containerFile = `/tmp/${targetName}.dump`
  // Local Docker mode is opt-in and pinned to the container created for this task.
  if (container && container !== 'msm-accounting-qa-db') throw new Error('Restore tests refuse unrelated containers')
  let createdTarget = false
  try {
    const bill = await prisma.bill.create({ data: { organizationId: org.orgId, number: 'RESTORE-BILL', vendorId,
      issueDate: new Date('2026-09-15'), status: 'OPEN', subtotal: 1500, totalAmount: 1500,
      lines: { create: [{ lineNo: 1, description: 'Restore expense', accountId: org.accounts.cogsExpense, quantity: 1, price: 1500, lineTotal: 1500 }] } }, include: { lines: true } })
    await prisma.$transaction(tx => postBillToLedger(tx, org.orgId, bill))
    const payment = await prisma.aPPayment.create({ data: { organizationId: org.orgId, number: 'RESTORE-PAYMENT', vendorId,
      date: new Date('2026-09-15'), status: 'COMPLETED', totalAmount: 600,
      allocations: { create: [{ billId: bill.id, amountApplied: 600 }] } } })
    await prisma.$transaction(async tx => { await postApPaymentIfNeeded(tx, org.orgId, payment.id); await syncApPaymentSettlement(tx, org.orgId, payment.id) })
    async function snapshot(client: PrismaClient) {
      const where = { organizationId: org.orgId }
      return JSON.parse(JSON.stringify({
        bills: await client.bill.findMany({ where, orderBy: { id: 'asc' }, include: { lines: { orderBy: { lineNo: 'asc' } } } }),
        payments: await client.aPPayment.findMany({ where, orderBy: { id: 'asc' }, include: { allocations: { orderBy: { id: 'asc' } } } }),
        journals: await client.journalEntry.findMany({ where, orderBy: { id: 'asc' }, include: { lines: { orderBy: { id: 'asc' } } } }),
        accounts: await client.account.findMany({ where, orderBy: { id: 'asc' } }),
      }))
    }
    const before = await snapshot(prisma)
    expect(before.journals).toHaveLength(2)
    expect(before.payments[0].allocations[0].amountApplied).toBe('600')
    await prisma.$executeRawUnsafe(`CREATE DATABASE "${targetName}"`)
    createdTarget = true
    if (container) {
      if (!docker) throw new Error('QA_DOCKER_PATH is required with QA_POSTGRES_CONTAINER')
      await execFile(docker, ['exec', container, 'pg_dump', '-U', sourceUrl.username, '-d', sourceUrl.pathname.slice(1), '-Fc', '-f', containerFile])
      await execFile(docker, ['exec', container, 'pg_restore', '-U', sourceUrl.username, '--exit-on-error', '--no-owner', '-d', targetName, containerFile])
    } else {
      await runPgDump({ toolPath: resolvePgToolPath('pg_dump'), databaseUrl: sourceUrl.toString(), outFile: file })
      await runPgRestore({ toolPath: resolvePgToolPath('pg_restore'), databaseUrl: targetUrl.toString(), inFile: file })
    }
    expect(await snapshot(target)).toEqual(before)
    // A restored copy must remain independent of later source changes.
    await prisma.bill.update({ where: { id: bill.id }, data: { notes: 'Changed after backup' } })
    expect((await target.bill.findUniqueOrThrow({ where: { id: bill.id } })).notes).toBeNull()
    expect((await prisma.bill.findUniqueOrThrow({ where: { id: bill.id } })).notes).toBe('Changed after backup')
  } finally {
    await target.$disconnect()
    if (createdTarget) await prisma.$executeRawUnsafe(`DROP DATABASE "${targetName}" WITH (FORCE)`)
    if (container && docker) await execFile(docker, ['exec', container, 'rm', '-f', containerFile])
    // mkdtemp provides the exact owned directory; no user-provided paths are deleted.
    await fs.rm(dir, { recursive: true, force: true })
    await cleanupOrg(org.orgId)
  }
}, 60_000)
