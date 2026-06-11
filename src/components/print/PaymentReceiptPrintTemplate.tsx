import React from 'react';
import { formatIDR, terbilang } from '../../utils/formatters';

const mm = (value: number): string => `${value}mm`;

const basePageStyle: React.CSSProperties = {
    width: mm(210),
    minHeight: mm(297),
    padding: mm(20),
    background: '#fff',
    color: '#111827',
    fontFamily: 'Inter, Arial, sans-serif',
    fontSize: '12px',
};

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
}

const labelCell: React.CSSProperties = { padding: '6px 10px', border: '1px solid #d1d5db', fontWeight: 600, width: '160px', background: '#f9fafb' };
const valueCell: React.CSSProperties = { padding: '6px 10px', border: '1px solid #d1d5db' };

const PaymentReceiptPrintTemplate: React.FC<PaymentReceiptPrintTemplateProps> = ({ payment, direction, partyName, company = {} }) => {
    if (!payment) {
        return <div className="print-template" style={basePageStyle}>No payment selected.</div>;
    }

    const amount = toNumber(payment.amount);
    const receiptNo = payment.number || payment.id || '-';
    const partyHeading = direction === 'in' ? 'Received From' : 'Paid To';
    const reference = payment.invoiceId || payment.billId || '-';
    const referenceLabel = direction === 'in' ? 'Invoice Ref' : 'Bill Ref';
    const signatureLabel = direction === 'in' ? 'Recipient' : 'Authorised By';

    return (
        <div className="print-template" style={basePageStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
                <div>
                    {company.logoUrl ? (
                        <img src={company.logoUrl} alt="Company logo" style={{ width: '120px', maxHeight: '48px', marginBottom: '10px', objectFit: 'contain' }} />
                    ) : null}
                    <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700 }}>{company.companyName || 'PT. Internal Accounting'}</h1>
                    <div>{company.address || '-'}</div>
                    <div>{company.phone || '-'} | {company.email || '-'}</div>
                    <div>NPWP: {company.npwp || '-'}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                    <h2 style={{ margin: 0, fontSize: '24px', letterSpacing: '0.04em' }}>PAYMENT RECEIPT</h2>
                    <div style={{ fontSize: '13px', color: '#6b7280' }}>KWITANSI</div>
                    <div style={{ marginTop: '8px' }}><strong>No:</strong> {receiptNo}</div>
                    <div><strong>Date:</strong> {formatLongDate(payment.date)}</div>
                </div>
            </div>

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
                        <td style={valueCell}>{payment.method || '-'}</td>
                    </tr>
                    <tr>
                        <td style={labelCell}>{referenceLabel}</td>
                        <td style={valueCell}>{reference}</td>
                    </tr>
                </tbody>
            </table>

            <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '40px' }}>
                <div style={{ border: '2px solid #111827', borderRadius: '6px', padding: '12px 20px', fontSize: '20px', fontWeight: 700 }}>
                    {formatIDR(amount)}
                </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '40px' }}>
                <div style={{ width: '200px', textAlign: 'center' }}>
                    <div style={{ marginBottom: '4px' }}>{company.companyName || 'PT. Internal Accounting'}</div>
                    <div style={{ marginBottom: '48px', color: '#6b7280' }}>{signatureLabel}</div>
                    <div style={{ borderTop: '1px solid #111827', paddingTop: '4px' }}>(&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;)</div>
                </div>
            </div>
        </div>
    );
};

export default PaymentReceiptPrintTemplate;
