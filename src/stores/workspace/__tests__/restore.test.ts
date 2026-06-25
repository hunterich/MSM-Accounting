// src/stores/workspace/__tests__/restore.test.ts
import { describe, it, expect } from 'vitest';
import { planRestore } from '../restore';
import { makeTabId, type WorkspaceTab, type TabTarget } from '../types';

const mk = (entity: string, recordId: string | null, mode: TabTarget['mode'], draft?: unknown): WorkspaceTab => {
    const target: TabTarget = { module: 'ar', entity, recordId, mode };
    return {
        id: makeTabId(target),
        kind: 'doc-form',
        title: 't',
        target,
        path: '/x',
        status: recordId === null ? 'new' : (draft ? 'dirty' : 'clean'),
        draft,
    };
};

describe('planRestore', () => {
    it('plans a refetch for saved documents', () => {
        const plan = planRestore([mk('sales-order', 'SO-1', 'view')]);
        expect(plan).toEqual([{ tabId: mk('sales-order', 'SO-1', 'view').id, action: 'refetch', recordId: 'SO-1' }]);
    });

    it('plans reopen-draft for an unsaved new form', () => {
        const tab = mk('sales-order', null, 'create', { customerId: 'C1' });
        const plan = planRestore([tab]);
        expect(plan).toEqual([{ tabId: tab.id, action: 'reopen-draft' }]);
    });

    it('plans reopen-draft for a dirty edit form that has a draft', () => {
        const tab = mk('sales-order', 'SO-9', 'edit', { reference: 'half typed' });
        const plan = planRestore([tab]);
        expect(plan).toEqual([{ tabId: tab.id, action: 'reopen-draft' }]);
    });

    it('NEVER plans a commit/post for any tab (the load-bearing invariant)', () => {
        const plan = planRestore([
            mk('sales-order', 'SO-1', 'view'),
            mk('sales-order', null, 'create', { customerId: 'C1' }),
            mk('invoice', 'INV-2', 'edit', { x: 1 }),
        ]);
        expect(plan.every((p) => p.action === 'refetch' || p.action === 'reopen-draft')).toBe(true);
    });
});
