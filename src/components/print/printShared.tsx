import React from 'react';

export interface PrintCompanyInfo {
    logoUrl?: string;
    companyName?: string;
    address?: string;
    phone?: string;
    email?: string;
    npwp?: string;
}

/**
 * Company identity block shared by every print template.
 *
 * The company name falls back to a placeholder, but the contact lines
 * (address / phone+email / NPWP) are omitted entirely when blank — so an
 * org with a partial profile prints a clean header instead of bare dashes.
 */
export const CompanyBlock: React.FC<{ company?: PrintCompanyInfo }> = ({ company = {} }) => {
    const contactLine = [company.phone, company.email].filter(Boolean).join(' | ');
    return (
        <div>
            {company.logoUrl ? (
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

/**
 * Outer page style for print templates. Width is fluid (100%) so the
 * PrintPreviewModal's A4/A5 container controls the actual paper dimensions;
 * border-box keeps the 20mm padding inside that width.
 */
export const PRINT_PAGE_STYLE: React.CSSProperties = {
    width: '100%',
    minHeight: '100%',
    padding: '20mm',
    boxSizing: 'border-box',
    background: '#fff',
    color: '#111827',
    fontFamily: 'Inter, Arial, sans-serif',
    fontSize: '12px',
};
