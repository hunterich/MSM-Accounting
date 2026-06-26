import React from 'react';
import { DEFAULT_PRINT_OPTIONS, type PrintOptions } from '../../types';
import { terbilang } from '../../utils/formatters';

export type { PrintOptions } from '../../types';
export { DEFAULT_PRINT_OPTIONS } from '../../types';

export interface PrintCompanyInfo {
    logoUrl?: string;
    companyName?: string;
    address?: string;
    phone?: string;
    email?: string;
    npwp?: string;
}

// ── Density → spacing/typography ──────────────────────────────────────────────
const DENSITY: Record<PrintOptions['density'], { fontSize: string; cellPad: string; titleSize: string }> = {
    compact: { fontSize: '11px', cellPad: '4px 6px', titleSize: '24px' },
    comfortable: { fontSize: '12px', cellPad: '6px', titleSize: '28px' },
    spacious: { fontSize: '13px', cellPad: '9px', titleSize: '32px' },
};

// Mix a hex color toward white by `ratio` (0..1) — used for subtle accent tints.
const tint = (hex: string, ratio: number): string => {
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return '#f3f4f6';
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
    const mix = (c: number) => Math.round(c + (255 - c) * ratio);
    return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
};

/** Outer page style — density controls font size; fluid width lets the modal pick A4/A5. */
export function pageStyle(options: PrintOptions = DEFAULT_PRINT_OPTIONS): React.CSSProperties {
    return {
        width: '100%',
        minHeight: '100%',
        padding: '20mm',
        boxSizing: 'border-box',
        background: '#fff',
        color: '#111827',
        fontFamily: 'Inter, Arial, sans-serif',
        fontSize: DENSITY[options.density].fontSize,
    };
}

/** Back-compat constant (comfortable density). */
export const PRINT_PAGE_STYLE = pageStyle(DEFAULT_PRINT_OPTIONS);

export function cellStyle(options: PrintOptions = DEFAULT_PRINT_OPTIONS): React.CSSProperties {
    return { border: '1px solid #d1d5db', padding: DENSITY[options.density].cellPad, textAlign: 'left' };
}
export function cellRightStyle(options: PrintOptions = DEFAULT_PRINT_OPTIONS): React.CSSProperties {
    return { ...cellStyle(options), textAlign: 'right' };
}

/** Document title (e.g. "INVOICE") — tinted with the accent color. */
export function titleStyle(options: PrintOptions = DEFAULT_PRINT_OPTIONS): React.CSSProperties {
    return { margin: 0, fontSize: DENSITY[options.density].titleSize, letterSpacing: '0.04em', color: options.accentColor };
}

/** Table header cell — subtle accent-tinted background + accent bottom border. */
export function tableHeadCellStyle(options: PrintOptions = DEFAULT_PRINT_OPTIONS, align: 'left' | 'right' = 'left'): React.CSSProperties {
    return {
        ...cellStyle(options),
        textAlign: align,
        background: tint(options.accentColor, 0.88),
        borderBottom: `2px solid ${options.accentColor}`,
        fontWeight: 600,
    };
}

/** Accent color for the TOTAL row. */
export function totalAccent(options: PrintOptions = DEFAULT_PRINT_OPTIONS): string {
    return options.accentColor;
}

/**
 * Company identity block. Honors `showLogo`; omits blank contact lines so a
 * partial profile prints clean (no bare dashes).
 */
export const CompanyBlock: React.FC<{ company?: PrintCompanyInfo; showLogo?: boolean }> = ({ company = {}, showLogo = true }) => {
    const contactLine = [company.phone, company.email].filter(Boolean).join(' | ');
    return (
        <div>
            {showLogo && company.logoUrl ? (
                <img
                    src={company.logoUrl}
                    alt="Company logo"
                    style={{ width: '120px', maxHeight: '48px', marginBottom: '10px', objectFit: 'contain' }}
                />
            ) : null}
            <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700 }}>
                {company.companyName || 'PT. Internal Accounting'}
            </h1>
            {company.address ? <div>{company.address}</div> : null}
            {contactLine ? <div>{contactLine}</div> : null}
            {company.npwp ? <div>NPWP: {company.npwp}</div> : null}
        </div>
    );
};

/** Thin accent band rendered under the company header when enabled. */
export const Letterhead: React.FC<{ options?: PrintOptions }> = ({ options = DEFAULT_PRINT_OPTIONS }) => {
    if (!options.showLetterhead) return null;
    return <div style={{ height: '4px', background: options.accentColor, margin: '0 0 14px' }} />;
};

/** Terms block + centered footer line, shown only when text is configured. */
export const DocumentFooter: React.FC<{ options?: PrintOptions }> = ({ options = DEFAULT_PRINT_OPTIONS }) => {
    if (!options.termsText && !options.footerText) return null;
    return (
        <div style={{ marginTop: '18px', borderTop: '1px solid #d1d5db', paddingTop: '10px' }}>
            {options.termsText ? (
                <div style={{ whiteSpace: 'pre-wrap', color: '#374151', marginBottom: options.footerText ? '10px' : 0 }}>
                    <strong>Terms &amp; Conditions:</strong>
                    <div>{options.termsText}</div>
                </div>
            ) : null}
            {options.footerText ? (
                <div style={{ textAlign: 'center', color: '#6b7280' }}>{options.footerText}</div>
            ) : null}
        </div>
    );
};

/** Signature block for money documents (label + line + optional signer name). */
export const SignatureBlock: React.FC<{ options?: PrintOptions }> = ({ options = DEFAULT_PRINT_OPTIONS }) => {
    if (!options.showSignature) return null;
    return (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '32px' }}>
            <div style={{ width: '220px', textAlign: 'center' }}>
                <div style={{ marginBottom: '4px' }}>{options.signatureLabel || 'Hormat kami,'}</div>
                <div style={{ height: '52px' }} />
                <div style={{ borderTop: '1px solid #111827', paddingTop: '4px' }}>
                    {options.signerName || '(        )'}
                </div>
            </div>
        </div>
    );
};

/** Amount-in-words line (Bahasa Indonesia), shown when enabled. */
export const TerbilangLine: React.FC<{ amount: number; options?: PrintOptions }> = ({ amount, options = DEFAULT_PRINT_OPTIONS }) => {
    if (!options.showTerbilang) return null;
    return (
        <div style={{ margin: '10px 0', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '4px', padding: '8px 10px', fontStyle: 'italic', color: '#374151' }}>
            <strong style={{ fontStyle: 'normal' }}>Terbilang:</strong> {terbilang(amount)}
        </div>
    );
};

/** Bank / payment-instruction block. Hides itself when no bank is configured. */
export const BankBlock: React.FC<{ options?: PrintOptions }> = ({ options = DEFAULT_PRINT_OPTIONS }) => {
    if (!options.showBankDetails || !options.bankName) return null;
    return (
        <div style={{ marginTop: '12px' }}>
            <div style={{ textTransform: 'uppercase', fontSize: '10px', letterSpacing: '0.05em', color: '#9ca3af', marginBottom: '2px' }}>Pembayaran ke</div>
            <div>{[options.bankName, options.bankAccountNo].filter(Boolean).join(' · ')}</div>
            {options.bankAccountName ? <div>a.n. {options.bankAccountName}</div> : null}
            {options.paymentNote ? <div style={{ color: '#6b7280', marginTop: '4px' }}>{options.paymentNote}</div> : null}
        </div>
    );
};
