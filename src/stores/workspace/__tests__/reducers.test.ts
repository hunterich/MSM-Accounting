import { describe, it, expect } from 'vitest';
import {
    openTab, closeTab, closeOthers, closeAll, closeToRight,
    activateTab, setStatus, saveDraft, clearDraft, isAtCap, pushClosed, capBlock, isPinnedTab,
} from '../reducers';
import { makeTabId, TAB_CAP, MODULE_CAP, type WorkspaceState, type TabTarget } from '../types';

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

describe('two-level cap — modules vs docs-per-module', () => {
    // Distinct AR entities → distinct module keys (ar/<entity>).
    const docInModule = (m: number, rec: string) => tab(`m${m}`, rec);

    it('caps documents within a single module at TAB_CAP, independently', () => {
        let s: WorkspaceState = empty;
        for (let i = 0; i < TAB_CAP; i++) s = openTab(s, docInModule(0, `R${i}`));
        expect(s.tabs).toHaveLength(TAB_CAP);
        // 11th doc in the SAME module is blocked…
        const overflow = openTab(s, docInModule(0, 'OVER'));
        expect(overflow.tabs).toHaveLength(TAB_CAP);
        // …but a doc in a DIFFERENT module still opens (separate count).
        const other = openTab(s, docInModule(1, 'R0'));
        expect(other.tabs).toHaveLength(TAB_CAP + 1);
    });

    it('caps the number of open modules at MODULE_CAP', () => {
        let s: WorkspaceState = empty;
        for (let i = 0; i < MODULE_CAP; i++) s = openTab(s, docInModule(i, 'R0'));
        expect(new Set(s.tabs.map((t) => t.target.entity)).size).toBe(MODULE_CAP);
        // An 11th distinct module is blocked…
        const overflow = openTab(s, docInModule(MODULE_CAP, 'R0'));
        expect(overflow.tabs).toHaveLength(MODULE_CAP);
        // …but a 2nd doc in an already-open module still opens.
        const sameModule = openTab(s, docInModule(0, 'R1'));
        expect(sameModule.tabs).toHaveLength(MODULE_CAP + 1);
    });

    it('capBlock reports which cap was hit (or null)', () => {
        let s: WorkspaceState = empty;
        for (let i = 0; i < TAB_CAP; i++) s = openTab(s, docInModule(0, `R${i}`));
        expect(capBlock(s, docInModule(0, 'OVER'))).toBe('doc');     // module full
        expect(capBlock(s, docInModule(1, 'R0'))).toBeNull();        // new module ok

        let m: WorkspaceState = empty;
        for (let i = 0; i < MODULE_CAP; i++) m = openTab(m, docInModule(i, 'R0'));
        expect(capBlock(m, docInModule(MODULE_CAP, 'R0'))).toBe('module'); // too many modules
        expect(capBlock(m, docInModule(0, 'R1'))).toBeNull();             // existing module ok
    });
});

describe('closeToRight', () => {
    it('closes every tab to the right of the given one, keeping it and those to its left', () => {
        let s: WorkspaceState = empty;
        s = openTab(s, tab('sales-order', 'A'));
        s = openTab(s, tab('sales-order', 'B'));
        s = openTab(s, tab('sales-order', 'C'));
        s = openTab(s, tab('sales-order', 'D'));
        const trimmed = closeToRight(s, s.tabs[1].id); // keep A, B
        expect(trimmed.tabs.map((t) => t.target.recordId)).toEqual(['A', 'B']);
    });

    it('moves active onto the anchor tab when the active tab was to the right', () => {
        let s: WorkspaceState = empty;
        s = openTab(s, tab('sales-order', 'A'));
        s = openTab(s, tab('sales-order', 'B'));
        s = openTab(s, tab('sales-order', 'C')); // active = C (to the right of A)
        const trimmed = closeToRight(s, s.tabs[0].id); // keep A only
        expect(trimmed.tabs.map((t) => t.target.recordId)).toEqual(['A']);
        expect(trimmed.activeTabId).toBe(s.tabs[0].id);
    });

    it('is a no-op when the anchor is the rightmost tab', () => {
        let s: WorkspaceState = empty;
        s = openTab(s, tab('sales-order', 'A'));
        s = openTab(s, tab('sales-order', 'B'));
        const same = closeToRight(s, s.tabs[1].id);
        expect(same.tabs).toHaveLength(2);
        expect(same.activeTabId).toBe(s.tabs[1].id);
    });
});

describe('pushClosed', () => {
    const t = (id: string) => ({ ...tab('sales-order', id), id });

    it('appends closed tabs so the most-recently-closed is last', () => {
        const stack = pushClosed([t('A')], [t('B'), t('C')], 10);
        expect(stack.map((x) => x.id)).toEqual(['A', 'B', 'C']);
    });

    it('caps the stack length, dropping the oldest entries', () => {
        const start = [t('a'), t('b'), t('c')];
        const stack = pushClosed(start, [t('d')], 3);
        expect(stack.map((x) => x.id)).toEqual(['b', 'c', 'd']);
    });

    it('drops an earlier entry with the same id so reopening is unambiguous', () => {
        const stack = pushClosed([t('A'), t('B')], [t('A')], 10);
        expect(stack.map((x) => x.id)).toEqual(['B', 'A']);
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

describe('the dashboard tab is permanent', () => {
    // Accurate keeps its home tab always open; ours does the same. Hiding the
    // close button is not enough — the bulk closes have to respect it too, or
    // "Close all" leaves the workspace with no tabs and an empty shell.
    const dashboard = () => {
        const target: TabTarget = { module: 'page', entity: 'route', recordId: 'dashboard', mode: 'view' };
        return {
            id: makeTabId(target),
            kind: 'list' as const,
            title: 'Dashboard',
            target,
            path: '/',
            status: 'clean' as const,
        };
    };

    const withDashboardAnd = (...records: string[]) => {
        let s = openTab(empty, dashboard());
        for (const r of records) s = openTab(s, tab('sales-order', r));
        return s;
    };

    it('recognises only the dashboard as pinned', () => {
        expect(isPinnedTab(dashboard())).toBe(true);
        expect(isPinnedTab(tab('sales-order', 'SO-1'))).toBe(false);
    });

    it('closeTab refuses to close it', () => {
        const s = withDashboardAnd('SO-1');
        const after = closeTab(s, s.tabs[0].id);
        expect(after.tabs).toHaveLength(2);
        expect(after.tabs.some(isPinnedTab)).toBe(true);
    });

    it('closeOthers keeps it alongside the tab being kept', () => {
        const s = withDashboardAnd('SO-1', 'SO-2');
        const after = closeOthers(s, s.tabs[2].id);
        expect(after.tabs.map((t) => t.title).sort()).toEqual(['Dashboard', 'sales-order:SO-2']);
        expect(after.activeTabId).toBe(s.tabs[2].id);
    });

    it('closeToRight keeps it even when it sits to the right', () => {
        // Dashboard opened last, so it is to the right of the anchor.
        let s = openTab(empty, tab('sales-order', 'SO-1'));
        s = openTab(s, tab('sales-order', 'SO-2'));
        s = openTab(s, dashboard());
        const after = closeToRight(s, s.tabs[0].id);
        expect(after.tabs.map((t) => t.title)).toEqual(['sales-order:SO-1', 'Dashboard']);
    });

    it('closeAll leaves it standing and active', () => {
        const s = withDashboardAnd('SO-1', 'SO-2');
        const after = closeAll(s);
        expect(after.tabs).toHaveLength(1);
        expect(isPinnedTab(after.tabs[0])).toBe(true);
        expect(after.activeTabId).toBe(after.tabs[0].id);
    });

    it('closeAll on a workspace without one still empties it', () => {
        const s = openTab(empty, tab('sales-order', 'SO-1'));
        expect(closeAll(s).tabs).toHaveLength(0);
        expect(closeAll(s).activeTabId).toBeNull();
    });
});
