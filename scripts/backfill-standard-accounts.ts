/**
 * Add any missing standard-chart accounts to organizations that already exist.
 *
 *   npm run db:backfill-accounts            # dry run — reports, changes nothing
 *   npm run db:backfill-accounts -- --apply
 *
 * `bootstrapOrganization` only runs when a company is created, so companies made
 * before an account was added to the standard chart never receive it. That is
 * not cosmetic: the account-default resolver falls back to "first account of an
 * allowed type" when it finds no candidate, silently posting purchase returns
 * and input tax to whatever sorts first — Cash and Bank, in the shipped chart.
 *
 * Only ever creates accounts whose CODE is absent. An organization that has
 * deliberately repurposed a code keeps what it has and is reported, never
 * overwritten. Re-running is a no-op.
 */
import { PrismaClient } from '@prisma/client';
import {
  STANDARD_ROOT_ACCOUNTS,
  STANDARD_CHILD_ACCOUNTS,
} from '../lib/organization/bootstrap';
import {
  ACCOUNT_DEFAULT_SPECS,
  resolveAccountDefaultId,
  type AccountDefaultKey,
} from '../lib/account-defaults';

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();

const TYPE_LABEL: Record<string, string> = {
  ASSET: 'Asset', LIABILITY: 'Liability', EQUITY: 'Equity', REVENUE: 'Revenue', EXPENSE: 'Expense',
};

type AccountRow = { id: string; code: string; name: string; type: string; isActive: boolean; isPostable: boolean };

/** The resolver expects the client-side type labels, not the prisma enum. */
const forResolver = (rows: AccountRow[]) =>
  rows.map((a) => ({ ...a, type: TYPE_LABEL[a.type] ?? a.type }));

function resolveAll(rows: AccountRow[]): Record<string, string> {
  const accounts = forResolver(rows);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const out: Record<string, string> = {};
  for (const key of Object.keys(ACCOUNT_DEFAULT_SPECS) as AccountDefaultKey[]) {
    const hit = byId.get(resolveAccountDefaultId(accounts, {}, key));
    out[key] = hit ? `${hit.code} ${hit.name}` : '(none)';
  }
  return out;
}

async function main() {
  const orgs = await prisma.organization.findMany({ select: { id: true, displayName: true } });
  if (orgs.length === 0) {
    console.log('No organizations found — nothing to backfill.');
    return;
  }

  console.log(APPLY ? 'Applying changes.\n' : 'Dry run — pass --apply to write changes.\n');
  let totalCreated = 0;

  for (const org of orgs) {
    const rows = (await prisma.account.findMany({
      where: { organizationId: org.id },
      select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
    })) as AccountRow[];

    const have = new Set(rows.map((a) => a.code));
    const missingRoots = STANDARD_ROOT_ACCOUNTS.filter((a) => !have.has(a.code));
    const missingChildren = STANDARD_CHILD_ACCOUNTS.filter((a) => !have.has(a.code));

    console.log(`── ${org.displayName} (${org.id})`);
    if (missingRoots.length === 0 && missingChildren.length === 0) {
      console.log('   already complete\n');
      continue;
    }

    const before = resolveAll(rows);

    for (const a of [...missingRoots, ...missingChildren]) {
      console.log(`   + ${a.code}  ${a.name}`);
    }

    if (APPLY) {
      // Roots first: children need a parent id, and a root may itself be absent.
      const idByCode = new Map(rows.map((a) => [a.code, a.id]));
      for (const a of missingRoots) {
        const created = await prisma.account.create({
          data: {
            organizationId: org.id,
            code: a.code, name: a.name,
            type: a.type as never, normalSide: a.normalSide as never,
            isActive: true, isPostable: false,
          },
          select: { id: true },
        });
        idByCode.set(a.code, created.id);
      }
      for (const a of missingChildren) {
        const parentId = idByCode.get(a.parentCode);
        if (!parentId) {
          console.log(`   ! skipped ${a.code}: parent ${a.parentCode} missing`);
          continue;
        }
        await prisma.account.create({
          data: {
            organizationId: org.id,
            code: a.code, name: a.name,
            type: a.type as never, normalSide: a.normalSide as never,
            parentId, isActive: true, isPostable: true,
          },
        });
      }
      totalCreated += missingRoots.length + missingChildren.length;

      const after = resolveAll(
        (await prisma.account.findMany({
          where: { organizationId: org.id },
          select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
        })) as AccountRow[],
      );
      // The point of the exercise: which roles stop guessing.
      for (const key of Object.keys(before)) {
        if (before[key] !== after[key]) {
          console.log(`   ${key}: ${before[key]}  ->  ${after[key]}`);
        }
      }
    }
    console.log('');
  }

  console.log(
    APPLY
      ? `Done. Created ${totalCreated} account(s).`
      : 'Dry run complete — no changes written.',
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
