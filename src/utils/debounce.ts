// src/utils/debounce.ts
export interface Debounced<A extends unknown[]> {
    (...args: A): void;
    flush: () => void;
    cancel: () => void;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, delay: number): Debounced<A> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: A | null = null;

    const run = () => {
        if (pending) { fn(...pending); pending = null; }
        timer = null;
    };

    const debounced = ((...args: A) => {
        pending = args;
        if (timer) clearTimeout(timer);
        timer = setTimeout(run, delay);
    }) as Debounced<A>;

    debounced.flush = () => { if (timer) { clearTimeout(timer); run(); } };
    debounced.cancel = () => { if (timer) { clearTimeout(timer); timer = null; } pending = null; };
    return debounced;
}
