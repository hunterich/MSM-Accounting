import { describe, it, expect } from 'vitest';
import { formatIDR, formatDateID, formatNumber } from '../formatters';

describe('formatIDR', () => {
    it('formats a positive integer', () => {
        const result = formatIDR(1500000);
        // Intl may use non-breaking space — normalise for assertion
        const norm = result.replace(/\s/g, ' ');
        expect(norm).toContain('1.500.000');
        expect(norm).toMatch(/Rp/);
    });

    it('formats zero', () => {
        const result = formatIDR(0);
        expect(result).toContain('0');
    });

    it('treats null / undefined as zero', () => {
        expect(formatIDR(null)).toEqual(formatIDR(0));
        expect(formatIDR(undefined)).toEqual(formatIDR(0));
    });

    it('formats a string number', () => {
        const result = formatIDR('250000');
        const norm = result.replace(/\s/g, ' ');
        expect(norm).toContain('250.000');
    });

    it('formats a negative amount', () => {
        const result = formatIDR(-100000);
        const norm = result.replace(/\s/g, ' ');
        expect(norm).toContain('100.000');
    });

    it('formats decimals with 2 fraction digits', () => {
        const result = formatIDR(1234.5);
        const norm = result.replace(/\s/g, ' ');
        expect(norm).toContain('1.234,50');
    });

    it('handles NaN-coercible input gracefully', () => {
        const result = formatIDR('not-a-number');
        expect(result).toContain('0');
    });
});

describe('formatDateID', () => {
    it('formats ISO date string to DD/MM/YYYY', () => {
        const result = formatDateID('2026-03-15');
        expect(result).toBe('15/03/2026');
    });

    it('returns empty string for falsy input', () => {
        expect(formatDateID('')).toBe('');
        expect(formatDateID(null)).toBe('');
        expect(formatDateID(undefined)).toBe('');
    });

    it('returns original string for unparseable date', () => {
        expect(formatDateID('not-a-date')).toBe('not-a-date');
    });

    it('handles Date-like ISO string with time', () => {
        const result = formatDateID('2026-01-05T10:30:00Z');
        expect(result).toMatch(/05\/01\/2026/);
    });
});

describe('formatNumber', () => {
    it('formats integer with Indonesian thousand separators', () => {
        const result = formatNumber(1500000);
        expect(result).toBe('1.500.000');
    });

    it('treats null as zero', () => {
        expect(formatNumber(null)).toBe('0');
    });

    it('formats string input', () => {
        expect(formatNumber('12345')).toBe('12.345');
    });
});
