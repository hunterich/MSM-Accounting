import { describe, it, expect } from 'vitest';
import { rankOptions } from '../searchableSelectMatch';

const opts = [
    { value: '1', label: 'Pomade Merah', subLabel: 'PMD-100' },
    { value: '2', label: 'Pomade Biru', subLabel: 'PMD-200' },
    { value: '3', label: 'Shampoo Anti Uban', subLabel: 'SHP-050' },
    { value: '4', label: 'Café Latte Syrup', subLabel: 'CAF-001' },
    { value: '5', label: 'Merah Delima', subLabel: 'MRH-900' },
];

describe('rankOptions', () => {
    it('returns all options in original order when query is empty', () => {
        expect(rankOptions(opts, '').map(o => o.value)).toEqual(['1', '2', '3', '4', '5']);
    });

    it('returns all options when query is only whitespace', () => {
        expect(rankOptions(opts, '   ').map(o => o.value)).toEqual(['1', '2', '3', '4', '5']);
    });

    it('matches tokens in any order (word-order independent)', () => {
        const result = rankOptions(opts, 'merah pomade');
        expect(result.map(o => o.value)).toContain('1');
        // "Merah Delima" lacks "pomade", so it must be excluded
        expect(result.map(o => o.value)).not.toContain('5');
    });

    it('requires every token to match (AND semantics)', () => {
        // "pomade" matches both pomades, "hijau" matches nothing
        expect(rankOptions(opts, 'pomade hijau')).toEqual([]);
    });

    it('ranks a code (subLabel) prefix match above a name (label) match', () => {
        // query "pmd" prefixes the codes of items 1 & 2, but only appears
        // as a code — make sure a code hit beats a name-only hit.
        const mixed = [
            { value: 'a', label: 'PMD Special Edition', subLabel: 'XYZ-1' }, // name contains pmd
            { value: 'b', label: 'Pomade Merah', subLabel: 'PMD-100' },      // code prefix pmd
        ];
        expect(rankOptions(mixed, 'pmd')[0].value).toBe('b');
    });

    it('ranks an exact code match at the very top', () => {
        expect(rankOptions(opts, 'PMD-200')[0].value).toBe('2');
    });

    it('ranks a name prefix above a name contains', () => {
        const result = rankOptions(opts, 'merah');
        // "Merah Delima" (prefix) should beat "Pomade Merah" (contains)
        expect(result[0].value).toBe('5');
    });

    it('ignores diacritics (café matches cafe)', () => {
        expect(rankOptions(opts, 'cafe').map(o => o.value)).toContain('4');
    });

    it('is case-insensitive', () => {
        expect(rankOptions(opts, 'POMADE').map(o => o.value).sort()).toEqual(['1', '2']);
    });

    it('returns empty array when nothing matches', () => {
        expect(rankOptions(opts, 'zzz')).toEqual([]);
    });

    it('handles options without a subLabel', () => {
        const noSub = [{ value: 'x', label: 'Walk In Customer' }];
        expect(rankOptions(noSub, 'walk').map(o => o.value)).toEqual(['x']);
        expect(rankOptions(noSub, 'nope')).toEqual([]);
    });

    it('stringifies numeric subLabels', () => {
        const numeric = [{ value: 'n', label: 'Item', subLabel: 12345 }];
        expect(rankOptions(numeric, '12345').map(o => o.value)).toEqual(['n']);
    });
});
