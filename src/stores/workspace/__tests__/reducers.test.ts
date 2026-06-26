import { describe, it, expect } from 'vitest';
import {
    openTab, closeTab, closeOthers, closeAll,
    activateTab, setStatus, saveDraft, clearDraft, isAtCap,
} from '../reducers';
import { makeTabId, TAB_CAP, type WorkspaceState, type TabTarget } from '../types';

const empty: WorkspaceState = { tabs: [], activeTabId: null };

const tab = (entity: string, recordId: string | null, mode: TabTarget['mode'] = 'view') => {
    const target: TabTarget = { module: 'ar', entity, recordId, mode };
    return {
        id: makeTabId(target),
        kind: 'doc-view' as const,
        title: `${entity}:${recordId ?? 'new'}`,
        target,
        path: `/ar/${entity}/${recordId ?? 'new'}`,
        status: 'clean' as const,
    };
};

describe('openTab', () => {
    it('adds a tab and activates it', () => {
        const s = openTab(empty, tab('sales-order', 'SO-1'));
        expect(s.tabs).toHaveLength(1);
        expect(s.activeTabId).toBe(makeTabId({ module: 'ar', entity: 'sales-order', recordId: 'SO-1', mode: 'view' }));
    });

    it('is idempotent — re-opening an open record activates it without duplicating', () => {
        const s1 = openTab(empty, tab('sales-order', 'SO-1'));
        const s2 = openTab(activateTab(s1, s1.tabs[0].id), tab('invoice', 'INV-1'));
        const s3 = openTab(s2, tab('sales-order', 'SO-1'));
        expect(s3.tabs).toHaveLength(2);
        expect(s3.activeTabId).toBe(s1.tabs[0].id);
    });

    it('does not add past the cap (no-op) but still activates an already-open tab', () => {
        let s: WorkspaceState = empty;
        for (let i = 0; i < TAB_CAP; i++) s = openTab(s, tab('sales-order', `SO-${i}`));
        expect(s.tabs).toHaveLength(TAB_CAP);
        const overflowed = openTab(s, tab('sales-order', 'SO-OVER'));
        expect(overflowed.tabs).toHaveLength(TAB_CAP);          // dropped
        const reopen = openTab(s, tab('sales-order', 'SO-0'));  // already open
        expect(reopen.activeTabId).toBe(s.tabs[0].id);
    });
});

describe('closeTab', () => {
    it('removes the tab and falls back to the left neighbour when closing the active one', () => {
        let s: WorkspaceState = empty;
        s = openTab(s, tab('sales-order', 'A'));
        s = openTab(s, tab('sales-order', 'B'));
        s = openTab(s, tab('sales-order', 'C')); // active = C
        const closed = closeTab(s, s.tabs[2].id);
        expect(closed.tabs.map((t) => t.target.recordId)).toEqual(['A', 'B']);
        expect(closed.activeTabId).toBe(closed.tabs[1].id); // B
    });

    it('clears active when the last tab is closed', () => {
        const s = openTab(empty, tab('sales-order', 'A'));
        const closed = closeTab(s, s.tabs[0].id);
        expect(closed.tabs).toHaveLength(0);
        expect(closed.activeTabId).toBeNull();
    });
});

describe('closeOthers / closeAll', () => {
    it('closeOthers keeps only the given tab and activates it', () => {
        let s: WorkspaceState = empty;
        s = openTab(s, tab('sales-order', 'A'));
        s = openTab(s, tab('sales-order', 'B'));
        s = openTab(s, tab('sales-order', 'C'));
        const only = closeOthers(s, s.tabs[0].id);
        expect(only.tabs.map((t) => t.target.recordId)).toEqual(['A']);
        expect(only.activeTabId).toBe(s.tabs[0].id);
    });

    it('closeAll empties the workspace', () => {
        let s: WorkspaceState = empty;
        s = openTab(s, tab('sales-order', 'A'));
        s = openTab(s, tab('sales-order', 'B'));
        const cleared = closeAll(s);
        expect(cleared).toEqual(empty);
    });
});

describe('status + drafts', () => {
    it('setStatus updates a single tab', () => {
        const s = openTab(empty, tab('sales-order', 'A'));
        const dirty = setStatus(s, s.tabs[0].id, 'dirty');
        expect(dirty.tabs[0].status).toBe('dirty');
    });

    it('saveDraft stores a snapshot and marks the tab dirty (or new for a create tab)', () => {
        const newTab = openTab(empty, { ...tab('sales-order', null, 'create'), kind: 'doc-form', status: 'new' });
        const withDraft = saveDraft(newTab, newTab.tabs[0].id, { customerId: 'C1' });
        expect(withDraft.tabs[0].draft).toEqual({ customerId: 'C1' });
        expect(withDraft.tabs[0].status).toBe('new');
    });

    it('clearDraft removes the snapshot and marks the tab clean', () => {
        const s = saveDraft(openTab(empty, { ...tab('sales-order', 'A'), kind: 'doc-form' }), makeTabId({ module: 'ar', entity: 'sales-order', recordId: 'A', mode: 'view' }), { x: 1 });
        const cleared = clearDraft(s, s.tabs[0].id);
        expect(cleared.tabs[0].draft).toBeUndefined();
        expect(cleared.tabs[0].status).toBe('clean');
    });
});

describe('isAtCap', () => {
    it('is true only when tab count reaches the cap', () => {
        let s: WorkspaceState = empty;
        for (let i = 0; i < TAB_CAP - 1; i++) s = openTab(s, tab('sales-order', `SO-${i}`));
        expect(isAtCap(s)).toBe(false);
        s = openTab(s, tab('sales-order', 'SO-last'));
        expect(isAtCap(s)).toBe(true);
    });
});
