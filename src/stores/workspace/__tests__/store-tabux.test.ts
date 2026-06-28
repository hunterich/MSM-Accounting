// Store-level behaviour for the tab-UX work: reopen-closed stack + the
// at-cap prompt. Pure reducers are covered in reducers.test.ts; here we drive
// the real zustand store so the cross-cutting bits (closedStack, capPrompt,
// moduleActive bookkeeping) are exercised end to end.
import { describe, it, expect, beforeEach } from 'vitest';

// zustand/persist reaches for localStorage at module load; vitest runs in node.
class MemStorage {
    private m = new Map<string, string>();
    getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
    setItem(k: string, v: string) { this.m.set(k, v); }
    removeItem(k: string) { this.m.delete(k); }
    clear() { this.m.clear(); }
}
(globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();

const { useWorkspaceStore } = await import('../../useWorkspaceStore');
import { makeTabId, TAB_CAP, MODULE_CAP, type TabTarget, type WorkspaceTab } from '../types';

const mkTab = (recordId: string, mode: TabTarget['mode'] = 'view'): WorkspaceTab => {
    const target: TabTarget = { module: 'ar', entity: 'invoice', recordId, mode };
    return { id: makeTabId(target), kind: 'doc-view', title: `INV-${recordId}`, target, path: `/ar/invoices?invoiceId=${recordId}`, status: 'clean' };
};

// A tab in a distinct module (ar/<entity>), one record each.
const mkModuleTab = (m: number): WorkspaceTab => {
    const target: TabTarget = { module: 'ar', entity: `e${m}`, recordId: 'R0', mode: 'view' };
    return { id: makeTabId(target), kind: 'doc-view', title: `E${m}`, target, path: `/x/${m}`, status: 'clean' };
};

const reset = () => useWorkspaceStore.setState({ tabs: [], activeTabId: null, moduleActive: {}, closedStack: [], capPrompt: null });

beforeEach(reset);

describe('reopen closed', () => {
    it('reopens the most-recently-closed tab and pops it off the stack', () => {
        const s = useWorkspaceStore.getState();
        s.openTab(mkTab('A'));
        s.openTab(mkTab('B'));
        useWorkspaceStore.getState().closeTab(mkTab('B').id);
        expect(useWorkspaceStore.getState().tabs.map((t) => t.target.recordId)).toEqual(['A']);

        const ok = useWorkspaceStore.getState().reopenClosed();
        expect(ok).toBe(true);
        const after = useWorkspaceStore.getState();
        expect(after.tabs.map((t) => t.target.recordId)).toEqual(['A', 'B']);
        expect(after.activeTabId).toBe(mkTab('B').id);
        expect(after.closedStack).toHaveLength(0);
    });

    it('returns false when there is nothing to reopen', () => {
        expect(useWorkspaceStore.getState().reopenClosed()).toBe(false);
    });

    it('records tabs closed via closeAll so they can be reopened', () => {
        const s = useWorkspaceStore.getState();
        s.openTab(mkTab('A'));
        s.openTab(mkTab('B'));
        useWorkspaceStore.getState().closeAll();
        expect(useWorkspaceStore.getState().tabs).toHaveLength(0);
        useWorkspaceStore.getState().reopenClosed();
        // most-recently-closed-last → B reopens first
        expect(useWorkspaceStore.getState().tabs.map((t) => t.target.recordId)).toEqual(['B']);
    });
});

describe('at-cap prompt', () => {
    const fill = () => {
        const s = useWorkspaceStore.getState();
        for (let i = 0; i < TAB_CAP; i++) s.openTab(mkTab(`C${i}`));
    };

    it('promptForCap stashes the blocked tab', () => {
        fill();
        const blocked = mkTab('OVER');
        useWorkspaceStore.getState().promptForCap(blocked);
        expect(useWorkspaceStore.getState().capPrompt?.id).toBe(blocked.id);
    });

    it('resolveCapPrompt closes the chosen tab and opens the blocked one', () => {
        fill();
        const blocked = mkTab('OVER');
        useWorkspaceStore.getState().promptForCap(blocked);
        const victim = useWorkspaceStore.getState().tabs[0].id;
        useWorkspaceStore.getState().resolveCapPrompt(victim);
        const after = useWorkspaceStore.getState();
        expect(after.tabs).toHaveLength(TAB_CAP);
        expect(after.tabs.some((t) => t.id === victim)).toBe(false);
        expect(after.tabs.some((t) => t.id === blocked.id)).toBe(true);
        expect(after.activeTabId).toBe(blocked.id);
        expect(after.capPrompt).toBeNull();
    });

    it('dismissCapPrompt clears the prompt without changing tabs', () => {
        fill();
        useWorkspaceStore.getState().promptForCap(mkTab('OVER'));
        useWorkspaceStore.getState().dismissCapPrompt();
        const after = useWorkspaceStore.getState();
        expect(after.capPrompt).toBeNull();
        expect(after.tabs).toHaveLength(TAB_CAP);
    });
});

describe('module-cap prompt', () => {
    it('resolveCapPromptByModule closes a whole module and opens the blocked tab', () => {
        const s = useWorkspaceStore.getState();
        for (let i = 0; i < MODULE_CAP; i++) s.openTab(mkModuleTab(i));
        const blocked = mkModuleTab(MODULE_CAP); // a brand-new (11th) module
        expect(useWorkspaceStore.getState().openTab(blocked)).toBe(false); // blocked by module cap
        useWorkspaceStore.getState().promptForCap(blocked);
        useWorkspaceStore.getState().resolveCapPromptByModule(mkModuleTab(0).target.entity === 'e0' ? 'ar/e0' : 'ar/e0');
        const after = useWorkspaceStore.getState();
        expect(after.tabs.some((t) => t.target.entity === 'e0')).toBe(false); // module e0 closed
        expect(after.tabs.some((t) => t.id === blocked.id)).toBe(true);       // blocked module opened
        expect(after.capPrompt).toBeNull();
    });
});
