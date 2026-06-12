import React from 'react';
import { formatIDR, terbilang, humanizeLabel } from '../../utils/formatters';
import {
    CompanyBlock, Letterhead, DocumentFooter,
    pageStyle, titleStyle, totalAccent,
    DEFAULT_PRINT_OPTIONS, type PrintOptions,
} from './printShared';

const formatLongDate = (value: string | null | undefined): string => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    }).format(date);
};

const toNumber = (value: unknown): number => {
    const num = Number(value || 0);
    return Number.isFinite(num) ? num : 0;
};

interface PaymentRecord {
    id?: string;
    number?: string;
    date?: string;
    method?: string;
    amount?: number | string;
    status?: string;
    invoiceId?: string;
    billId?: string;
}

interface CompanyInfo {
    logoUrl?: string;
    companyName?: string;
    address?: string;
    phone?: string;
    email?: string;
    npwp?: string;
}

interface PaymentReceiptPrintTemplateProps {
    payment?: PaymentRecord | null;
    direction: 'in' | 'out';   // in = received from customer (AR); out = paid to vendor (AP)
    partyName?: string;
    company?: CompanyInfo;
    options?: PrintOptions;
}

const labelCell: React.CSSProperties = { padding: '6px 10px', border: '1px solid #d1d5db', fontWeight: 600, width: '160px', background: '#f9fafb' };
const valueCell: React.CSSProperties = { padding: '6px 10px', border: '1px solid #d1d5db' };

const PaymentReceiptPrintTemplate: React.FC<PaymentReceiptPrintTemplateProps> = ({ payment, direction, partyName, company = {}, options = DEFAULT_PRINT_OPTIONS }) => {
    if (!payment) {
        return <div className="print-template" style={pageStyle(options)}>No payment selected.</div>;
    }

    const amount = toNumber(payment.amount);
    const receiptNo = payment.number || payment.id || '-';
    const partyHeading = direction === 'in' ? 'Received From' : 'Paid To';
    const reference = payment.invoiceId || payment.billId || '-';
    const referenceLabel = direction === 'in' ? 'Invoice Ref' : 'Bill Ref';
    const signatureLabel = options.signatureLabel || (direction === 'in' ? 'Recipient' : 'Authorised By');
    const accent = totalAccent(options);

    return (
        <div className="print-template" style={pageStyle(options)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '18px' }}>
                <CompanyBlock company={company} showLogo={options.showLogo} />
                <div style={{ textAlign: 'right' }}>
                    <h2 style={titleStyle(options)}>PAYMENT RECEIPT</h2>
                    <div style={{ fontSize: '13px', color: '#6b7280' }}>KWITANSI</div>
                    <div style={{ marginTop: '8px' }}><strong>No:</strong> {receiptNo}</div>
                    <div><strong>Date:</strong> {formatLongDate(payment.date)}</div>
                </div>
            </div>
            <Letterhead options={options} />

            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '18px' }}>
                <tbody>
                    <tr>
                        <td style={labelCell}>{partyHeading}</td>
                        <td style={valueCell}>{partyName || '-'}</td>
                    </tr>
                    <tr>
                        <td style={labelCell}>Terbilang</td>
                        <td style={{ ...valueCell, fontStyle: 'italic' }}>{terbilang(amount)}</td>
                    </tr>
                    <tr>
                        <td style={labelCell}>Payment Method</td>
                        <td style={valueCell}>{humanizeLabel(payment.method) || '-'}</td>
                    </tr>
                    <tr>
                        <td style={labelCell}>{referenceLabel}</td>
                        <td style={valueCell}>{reference}</td>
                    </tr>
                </tbody>
            </table>

            <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '32px' }}>
                <div style={{ border: `2px solid ${accent}`, borderRadius: '6px', padding: '12px 20px', fontSize: '20px', fontWeight: 700, color: accent }}>
                    {formatIDR(amount)}
                </div>
            </div>

            <DocumentFooter options={options} />

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '32px' }}>
                <div style={{ width: '200px', textAlign: 'center' }}>
                    <div style={{ marginBottom: '4px' }}>{company.companyName || 'PT. Internal Accounting'}</div>
                    <div style={{ marginBottom: '48px', color: '#6b7280' }}>{signatureLabel}</div>
                    <div style={{ borderTop: '1px solid #111827', paddingTop: '4px' }}>{options.signerName || '(        )'}</div>
                </div>
            </div>
        </div>
    );
};

export default PaymentReceiptPrintTemplate;
