import { useState, useCallback } from 'react';
import type { DocLine, DocCharge } from './types';

const rid = (p: string) => `${p}-${Date.now()}-${Math.round(Math.random() * 1e4)}`;

/**
 * useDocumentLines — line-item + additional-cost state for any document form.
 * Centralises the add/update/remove logic so SO/Invoice/PO/Bill don't each
 * reimplement it (the existing forms all duplicate this).
 */
export function useDocumentLines(initialLines: DocLine[] = [], initialCharges: DocCharge[] = []) {
    const [lines, setLines] = useState<DocLine[]>(initialLines);
    const [charges, setCharges] = useState<DocCharge[]>(initialCharges);

    const addLine = useCallback((seed?: Partial<DocLine>) => {
        setLines((ls) => [...ls, {
            id: rid('li'), code: '', description: '', qty: 1, unit: 'PCS', price: 0, discount: 0, ...seed,
        }]);
    }, []);

    const updateLine = useCallback((id: string, key: keyof DocLine, value: string | number) => {
        setLines((ls) => ls.map((l) => (l.id === id ? { ...l, [key]: value } : l)));
    }, []);

    const removeLine = useCallback((id: string) => {
        setLines((ls) => ls.filter((l) => l.id !== id));
    }, []);

    const addCharge = useCallback((seed?: Partial<DocCharge>) => {
        setCharges((cs) => [...cs, {
            id: rid('ch'), label: '', accountId: '', accountLabel: '', amount: 0, taxRate: 0, ...seed,
        }]);
    }, []);

    const updateCharge = useCallback((id: string, key: keyof DocCharge, value: string | number) => {
        setCharges((cs) => cs.map((c) => (c.id === id ? { ...c, [key]: value } : c)));
    }, []);

    const removeCharge = useCallback((id: string) => {
        setCharges((cs) => cs.filter((c) => c.id !== id));
    }, []);

    const dirty = lines.length > 0 || charges.length > 0;

    return {
        lines, charges, dirty,
        addLine, updateLine, removeLine,
        addCharge, updateCharge, removeCharge,
        setLines, setCharges,
    };
}
