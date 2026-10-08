import { useState } from 'react';

/** Keep each filter combination on its first page, including kept-alive tabs. */
export function useCatalogPagination<T extends Record<string, string | number | undefined>>(filters: T) {
    const key = JSON.stringify(filters);
    const [position, setPosition] = useState({ key, page: 1 });
    const [limit, setLimit] = useState(20);
    if (position.key !== key) setPosition({ key, page: 1 });
    const page = position.key === key ? position.page : 1;
    const onPageChange = (next: number) => setPosition({ key, page: Math.max(1, next) });
    const onLimitChange = (next: number) => {
        setLimit(next);
        setPosition({ key, page: 1 });
    };
    return { query: { ...filters, page, limit }, page, limit, onPageChange, onLimitChange };
}

export function catalogStatus(value: string) {
    return ({ Unpaid: 'OPEN', Billed: 'PARTIAL_RECEIVED' } as Record<string, string>)[value]
        ?? value.toUpperCase().replaceAll(' ', '_');
}
