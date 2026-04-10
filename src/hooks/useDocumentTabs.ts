import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

interface UseDocumentTabsOptions {
    urlParam?: string;   // search param name for selectedId (default: 'id')
    maxPerRow?: number;  // tabs per row (default: 5)
}

interface UseDocumentTabsReturn {
    selectedId: string;
    openIds: string[];
    openTab: (id: string) => void;
    closeTab: (id: string) => void;
    selectNone: () => void;  // deselect without closing any tabs
    tabRows: string[][];     // openIds split into rows of maxPerRow
}

export function useDocumentTabs(opts?: UseDocumentTabsOptions): UseDocumentTabsReturn {
    const maxPerRow = opts?.maxPerRow ?? 5;
    const urlParam = opts?.urlParam;

    const [searchParams] = useSearchParams();

    const initialId = urlParam ? (searchParams.get(urlParam) || '') : '';

    const [selectedId, setSelectedId] = useState<string>(initialId);
    const [openIds, setOpenIds] = useState<string[]>(() => (initialId ? [initialId] : []));

    const openTab = (id: string) => {
        setOpenIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
        setSelectedId(id);
    };

    const selectNone = () => {
        setSelectedId('');
    };

    const closeTab = (id: string) => {
        setOpenIds((prev) => {
            const idx = prev.indexOf(id);
            const next = prev.filter((openId) => openId !== id);
            if (selectedId === id) {
                if (next.length === 0) {
                    setSelectedId('');
                } else {
                    const fallback = next[Math.max(0, idx - 1)] || next[0];
                    setSelectedId(fallback);
                }
            }
            return next;
        });
    };

    const tabRows = useMemo<string[][]>(() => {
        const rows: string[][] = [];
        for (let i = 0; i < openIds.length; i += maxPerRow) {
            rows.push(openIds.slice(i, i + maxPerRow));
        }
        return rows;
    }, [openIds, maxPerRow]);

    return { selectedId, openIds, openTab, closeTab, selectNone, tabRows };
}
