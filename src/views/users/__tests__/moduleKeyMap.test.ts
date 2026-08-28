import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { MODULE_DEFS, MODULE_GROUP_ORDER } from '../moduleKeyMap';

/**
 * MODULE_DEFS is documented as "one entry per `enum ModuleKey` member". Nothing
 * enforced that, and POS_RETAIL / POS_REPORTS silently went missing — which made
 * the two POS admin modules ungrantable to any non-admin role, because the matrix
 * is the only place a role's permissions can be edited.
 *
 * Read the enum straight from the schema rather than importing @prisma/client:
 * the generated client is a cross-worktree artifact and may be stale here.
 */
function moduleKeyEnumMembers(): string[] {
    const schema = readFileSync(resolve(__dirname, '../../../../prisma/schema.prisma'), 'utf8');
    const block = /enum ModuleKey \{([\s\S]*?)\n\}/.exec(schema);
    if (!block) throw new Error('enum ModuleKey not found in prisma/schema.prisma');
    return block[1]
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('//'));
}

describe('MODULE_DEFS', () => {
    it('has exactly one row per ModuleKey enum member', () => {
        const enumMembers = moduleKeyEnumMembers();
        const rows = MODULE_DEFS.map((d) => d.moduleKey as string);

        expect(enumMembers.filter((k) => !rows.includes(k))).toEqual([]);
        expect(rows.filter((k) => !enumMembers.includes(k))).toEqual([]);
    });

    it('has no duplicate rows', () => {
        const rows = MODULE_DEFS.map((d) => d.moduleKey as string);
        expect(rows).toHaveLength(new Set(rows).size);
    });

    it('only uses groups declared in MODULE_GROUP_ORDER', () => {
        const unknown = MODULE_DEFS
            .map((d) => d.group)
            .filter((g) => !MODULE_GROUP_ORDER.includes(g));
        expect([...new Set(unknown)]).toEqual([]);
    });
});
