import { describe, it, expect } from 'vitest';
import { formatIDR, formatDateID, formatNumber, numberToWordsID, terbilang, humanizeLabel } from '../formatters';

describe('formatIDR', () => {
    it('formats a positive integer', () => {
        const result: string = formatIDR(1500000);
        // Intl may use non-breaking space — normalise for assertion
        const norm = result.replace(/\s/g, ' ');
        expect(norm).toContain('1.500.000');
        expect(norm).toMatch(/Rp/);
    });

    it('formats zero', () => {
        const result: string = formatIDR(0);
        expect(result).toContain('0');
    });

    it('treats null / undefined as zero', () => {
        expect(formatIDR(null)).toEqual(formatIDR(0));
        expect(formatIDR(undefined)).toEqual(formatIDR(0));
    });

    it('formats a string number', () => {
        const result: string = formatIDR('250000');
        const norm = result.replace(/\s/g, ' ');
        expect(norm).toContain('250.000');
    });

    it('formats a negative amount', () => {
        const result: string = formatIDR(-100000);
        const norm = result.replace(/\s/g, ' ');
        expect(norm).toContain('100.000');
    });

    it('formats decimals with 2 fraction digits', () => {
        const result: string = formatIDR(1234.5);
        const norm = result.replace(/\s/g, ' ');
        expect(norm).toContain('1.234,50');
    });

    it('handles NaN-coercible input gracefully', () => {
        const result: string = formatIDR('not-a-number');
        expect(result).toContain('0');
    });
});

describe('formatDateID', () => {
    it('formats ISO date string to DD/MM/YYYY', () => {
        const result: string = formatDateID('2026-03-15');
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
        const result: string = formatDateID('2026-01-05T10:30:00Z');
        expect(result).toMatch(/05\/01\/2026/);
    });
});

describe('formatNumber', () => {
    it('formats integer with Indonesian thousand separators', () => {
        const result: string = formatNumber(1500000);
        expect(result).toBe('1.500.000');
    });

    it('treats null as zero', () => {
        expect(formatNumber(null)).toBe('0');
    });

    it('formats string input', () => {
        expect(formatNumber('12345')).toBe('12.345');
    });
});

describe('numberToWordsID', () => {
    it('spells single digits and teens', () => {
        expect(numberToWordsID(0)).toBe('nol');
        expect(numberToWordsID(7)).toBe('tujuh');
        expect(numberToWordsID(11)).toBe('sebelas');
        expect(numberToWordsID(15)).toBe('lima belas');
    });

    it('spells tens and hundreds with Indonesian special cases', () => {
        expect(numberToWordsID(21)).toBe('dua puluh satu');
        expect(numberToWordsID(100)).toBe('seratus');
        expect(numberToWordsID(250)).toBe('dua ratus lima puluh');
    });

    it('uses "seribu" for exactly one thousand but "… ribu" otherwise', () => {
        expect(numberToWordsID(1000)).toBe('seribu');
        expect(numberToWordsID(2000)).toBe('dua ribu');
        expect(numberToWordsID(1500000)).toBe('satu juta lima ratus ribu');
    });

    it('spells millions and billions', () => {
        expect(numberToWordsID(1000000)).toBe('satu juta');
        expect(numberToWordsID(1234567)).toBe('satu juta dua ratus tiga puluh empat ribu lima ratus enam puluh tujuh');
        expect(numberToWordsID(2000000000)).toBe('dua miliar');
    });

    it('handles negatives, strings, and truncates decimals', () => {
        expect(numberToWordsID(-50)).toBe('minus lima puluh');
        expect(numberToWordsID('1500000')).toBe('satu juta lima ratus ribu');
        expect(numberToWordsID(1500.99)).toBe('seribu lima ratus');
        expect(numberToWordsID(null)).toBe('nol');
    });
});

describe('terbilang', () => {
    it('appends "rupiah" and capitalises', () => {
        expect(terbilang(1500000)).toBe('Satu juta lima ratus ribu rupiah');
        expect(terbilang(0)).toBe('Nol rupiah');
        expect(terbilang(1000)).toBe('Seribu rupiah');
    });
});

describe('humanizeLabel', () => {
    it('converts enum codes to title case', () => {
        expect(humanizeLabel('BANK_TRANSFER')).toBe('Bank Transfer');
        expect(humanizeLabel('e-wallet')).toBe('E Wallet');
        expect(humanizeLabel('CASH')).toBe('Cash');
    });

    it('title-cases already-spaced values', () => {
        expect(humanizeLabel('bank transfer')).toBe('Bank Transfer');
    });

    it('returns empty string for falsy input', () => {
        expect(humanizeLabel('')).toBe('');
        expect(humanizeLabel(null)).toBe('');
        expect(humanizeLabel(undefined)).toBe('');
    });
});
