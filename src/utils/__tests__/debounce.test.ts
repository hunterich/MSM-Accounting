// src/utils/__tests__/debounce.test.ts
import { describe, it, expect, vi } from 'vitest';
import { debounce } from '../debounce';

describe('debounce', () => {
    it('invokes once after the delay with the latest args', () => {
        vi.useFakeTimers();
        const spy = vi.fn();
        const d = debounce(spy, 200);
        d('a'); d('b'); d('c');
        expect(spy).not.toHaveBeenCalled();
        vi.advanceTimersByTime(200);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith('c');
        vi.useRealTimers();
    });

    it('flush() invokes immediately with the pending args', () => {
        vi.useFakeTimers();
        const spy = vi.fn();
        const d = debounce(spy, 200);
        d('x');
        d.flush();
        expect(spy).toHaveBeenCalledWith('x');
        vi.useRealTimers();
    });

    it('cancel() drops the pending invocation', () => {
        vi.useFakeTimers();
        const spy = vi.fn();
        const d = debounce(spy, 200);
        d('x');
        d.cancel();
        vi.advanceTimersByTime(500);
        expect(spy).not.toHaveBeenCalled();
        vi.useRealTimers();
    });
});
