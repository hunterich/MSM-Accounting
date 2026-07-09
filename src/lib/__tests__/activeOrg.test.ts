// Per-tab active-org module. vitest runs in node (no jsdom installed), so we
// stub sessionStorage/localStorage/window the same way store-tabux.test.ts does.
import { describe, it, expect, beforeEach } from 'vitest';

class MemStorage {
    private m = new Map<string, string>();
    getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
    setItem(k: string, v: string) { this.m.set(k, v); }
    removeItem(k: string) { this.m.delete(k); }
    clear() { this.m.clear(); }
}

const session = new MemStorage();
const local = new MemStorage();
(globalThis as unknown as { sessionStorage: MemStorage }).sessionStorage = session;
(globalThis as unknown as { localStorage: MemStorage }).localStorage = local;

let href = 'http://localhost:5173/';
const replaceStateCalls: string[] = [];
(globalThis as unknown as { window: unknown }).window = {
    location: {
        get href() { return href; },
    },
    history: {
        replaceState: (_state: unknown, _title: string, url: string) => {
            replaceStateCalls.push(url);
        },
    },
};

const { getActiveOrgId, setActiveOrgId, clearActiveOrg, getLastOrgId, bootstrapActiveOrg } =
    await import('../activeOrg');

beforeEach(() => {
    session.clear();
    local.clear();
    replaceStateCalls.length = 0;
    href = 'http://localhost:5173/';
});

describe('activeOrg', () => {
    it('returns null when no active org is set', () => {
        expect(getActiveOrgId()).toBeNull();
    });

    it('set/get round-trips through sessionStorage and records the last org', () => {
        setActiveOrgId('org-a');
        expect(getActiveOrgId()).toBe('org-a');
        expect(sessionStorage.getItem('msm-active-org')).toBe('org-a');
        expect(localStorage.getItem('msm-last-org')).toBe('org-a');
        expect(getLastOrgId()).toBe('org-a');
    });

    it('clearActiveOrg removes the sessionStorage key but keeps the last org', () => {
        setActiveOrgId('org-a');
        clearActiveOrg();
        expect(getActiveOrgId()).toBeNull();
        expect(getLastOrgId()).toBe('org-a');
    });
});

describe('bootstrapActiveOrg', () => {
    it('returns null when nothing is set and no ?org= present', () => {
        expect(bootstrapActiveOrg()).toBeNull();
        expect(replaceStateCalls).toHaveLength(0);
    });

    it('returns the sessionStorage value when set and no ?org= present', () => {
        setActiveOrgId('org-a');
        expect(bootstrapActiveOrg()).toBe('org-a');
        expect(replaceStateCalls).toHaveLength(0);
    });

    it('consumes ?org=: sets sessionStorage + last-org and strips the param', () => {
        href = 'http://localhost:5173/?org=org-b';
        expect(bootstrapActiveOrg()).toBe('org-b');
        expect(sessionStorage.getItem('msm-active-org')).toBe('org-b');
        expect(localStorage.getItem('msm-last-org')).toBe('org-b');
        expect(replaceStateCalls).toEqual(['/']);
    });

    it('?org= overrides an existing sessionStorage value', () => {
        setActiveOrgId('org-a');
        href = 'http://localhost:5173/?org=org-b';
        expect(bootstrapActiveOrg()).toBe('org-b');
        expect(getActiveOrgId()).toBe('org-b');
    });

    it('preserves other query params and the hash when stripping ?org=', () => {
        href = 'http://localhost:5173/ar/invoices?org=org-b&tab=open#section';
        expect(bootstrapActiveOrg()).toBe('org-b');
        expect(replaceStateCalls).toEqual(['/ar/invoices?tab=open#section']);
    });
});
