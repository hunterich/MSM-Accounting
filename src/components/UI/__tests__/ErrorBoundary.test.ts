import { describe, expect, it } from 'vitest';
import { isChunkLoadError } from '../ErrorBoundary';

describe('isChunkLoadError', () => {
    it.each([
        'Failed to fetch dynamically imported module: https://localhost/assets/ChartOfAccounts-old.js',
        'Importing a module script failed.',
        'Loading chunk 42 failed',
        'error loading dynamically imported module',
    ])('recognizes stale deployment errors: %s', (message) => {
        expect(isChunkLoadError(new Error(message))).toBe(true);
    });

    it('does not turn ordinary page errors into reloads', () => {
        expect(isChunkLoadError(new Error('Customer API returned 500'))).toBe(false);
        expect(isChunkLoadError(null)).toBe(false);
    });
});
