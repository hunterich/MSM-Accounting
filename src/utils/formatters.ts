export const formatIDR = (amount: number | string | null | undefined): string => {
    const raw = Number(amount || 0);
    const num = Number.isNaN(raw) ? 0 : raw;
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(num);
};

export const formatDateID = (dateStr: string | null | undefined): string => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return dateStr;
    return new Intl.DateTimeFormat('id-ID', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    }).format(date);
};

/** Date + time in the app's locale (id-ID), e.g. "03/09/2026, 10.15". */
export const formatDateTimeID = (value: string | Date | null | undefined): string => {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('id-ID', { dateStyle: 'short', timeStyle: 'short' }).format(date);
};

export const formatNumber = (num: number | string | null | undefined): string => {
    const value = Number(num || 0);
    return new Intl.NumberFormat('id-ID').format(value);
};

// Humanizes enum-style codes for display: BANK_TRANSFER → "Bank Transfer",
// "e-wallet" → "E Wallet". Already-spaced values are title-cased word by word.
export const humanizeLabel = (value: string | null | undefined): string => {
    if (!value) return '';
    return String(value)
        .replace(/[_-]+/g, ' ')
        .trim()
        .split(/\s+/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
};

const ONES = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];

// Spells out a non-negative integer below 1000 in Indonesian (no scale suffix).
const spellBelowThousand = (n: number): string => {
    if (n < 12) return ONES[n];
    if (n < 20) return `${spellBelowThousand(n - 10)} belas`;
    if (n < 100) {
        const tens = Math.floor(n / 10);
        const rest = n % 10;
        return `${spellBelowThousand(tens)} puluh${rest ? ` ${ONES[rest]}` : ''}`;
    }
    const hundreds = Math.floor(n / 100);
    const rest = n % 100;
    const prefix = hundreds === 1 ? 'seratus' : `${ONES[hundreds]} ratus`;
    return `${prefix}${rest ? ` ${spellBelowThousand(rest)}` : ''}`;
};

const SCALES: Array<{ value: number; name: string }> = [
    { value: 1_000_000_000_000, name: 'triliun' },
    { value: 1_000_000_000, name: 'miliar' },
    { value: 1_000_000, name: 'juta' },
    { value: 1_000, name: 'ribu' },
];

// Spells out an integer in Indonesian words (no "rupiah" suffix). Negatives → "minus …".
export const numberToWordsID = (input: number | string | null | undefined): string => {
    const raw = Math.trunc(Number(input || 0));
    if (!Number.isFinite(raw)) return 'nol';
    if (raw === 0) return 'nol';
    if (raw < 0) return `minus ${numberToWordsID(-raw)}`;

    let remainder = raw;
    const parts: string[] = [];
    for (const { value, name } of SCALES) {
        if (remainder >= value) {
            const count = Math.floor(remainder / value);
            // "seribu" is the special case for exactly one thousand.
            const spelled = value === 1_000 && count === 1 ? 'seribu' : `${spellBelowThousand(count)} ${name}`;
            parts.push(spelled);
            remainder %= value;
        }
    }
    if (remainder > 0) parts.push(spellBelowThousand(remainder));
    return parts.join(' ').replace(/\s+/g, ' ').trim();
};

// Indonesian rupiah amount in words, capitalised, e.g. 1500000 → "Satu juta lima ratus ribu rupiah".
export const terbilang = (amount: number | string | null | undefined): string => {
    const words = `${numberToWordsID(amount)} rupiah`;
    return words.charAt(0).toUpperCase() + words.slice(1);
};
