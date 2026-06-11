import React from 'react';
import { formatIDR } from '../../utils/formatters';
import { CompanyBlock, PRINT_PAGE_STYLE } from './printShared';

const basePageStyle = PRINT_PAGE_STYLE;

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

interface RawLineItem {
    id?: string;
    description?: string;
    itemName?: string;
    name?: string;
    qty?: number | string;
    quantity?: number | string;
    qtyReturn?: number | string;
    unit?: string;
    price?: number | string;
}

interface NormalizedLine {
    id: string;
    no: number;
    description: string;
    qty: number;
    unit: string;
    price: number;
    total: number;
}

const normalizeLine = (line: RawLineItem, index: number): NormalizedLine => {
    const description = line.description || line.itemName || line.name || '-';
    const qty = toNumber(line.qtyReturn ?? line.qty ?? line.quantity);
    const unit = line.unit || 'PCS';
    const price = toNumber(line.price);
    return {
        id: line.id || `${description}-${index + 1}`,
        no: index + 1,
        description,
        qty,
        unit,
        price,
        total: qty * price,
    };
};

interface NoteDocument {
    id?: string;
    number?: string;
    date?: string;
    status?: string;
    reference?: string;
    reason?: string;
    notes?: string;
    [key: string]: unknown;
}

interface CompanyInfo {
    logoUrl?: string;
    companyName?: string;
    address?: string;
    phone?: string;
    email?: string;
    npwp?: string;
}

interface NotePrintTemplateProps {
    title: string;          // e.g. "CREDIT NOTE", "SALES RETURN"
    partyLabel: string;     // "Customer" | "Vendor"
    partyName?: string;
    document?: NoteDocument | null;
    lineItems?: RawLineItem[];
    subtotal?: number;
    taxAmount?: number;
    total?: number;
    company?: CompanyInfo;
}

const cell: React.CSSProperties = { border: '1px solid #d1d5db', padding: '6px' };
const cellRight: React.CSSProperties = { ...cell, textAlign: 'right' };

const NotePrintTemplate: React.FC<NotePrintTemplateProps> = ({
    title,
    partyLabel,
    partyName,
    document,
    lineItems = [],
    subtotal,
    taxAmount,
    total,
    company = {},
}) => {
    if (!document) {
        return <div className="print-template" style={basePageStyle}>No document selected.</div>;
    }

    const rows = lineItems.map(normalizeLine);
    const computedSubtotal = rows.reduce((sum, row) => sum + row.total, 0);
    const resolvedSubtotal = subtotal ?? computedSubtotal;
    const resolvedTax = taxAmount ?? 0;
    const resolvedTotal = total ?? resolvedSubtotal + resolvedTax;

    const docNo = document.number || document.id || '-';

    return (
        <div className="print-template" style={basePageStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '18px' }}>
                <CompanyBlock company={company} />
                <div style={{ textAlign: 'right' }}>
                    <h2 style={{ margin: 0, fontSize: '26px', letterSpacing: '0.04em' }}>{title}</h2>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', border: '1px solid #d1d5db', marginBottom: '14px' }}>
                <div style={{ padding: '10px', borderRight: '1px solid #d1d5db' }}>
                    <div style={{ fontWeight: 600, marginBottom: '6px' }}>{partyLabel}:</div>
                    <div>{partyName || '-'}</div>
                </div>
                <div style={{ padding: '10px' }}>
                    <div><strong>No:</strong> {docNo}</div>
                    <div><strong>Date:</strong> {formatLongDate(document.date)}</div>
                    {document.reference ? <div><strong>Reference:</strong> {String(document.reference)}</div> : null}
                    <div><strong>Status:</strong> {document.status || '-'}</div>
                </div>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '14px' }}>
                <thead>
                    <tr>
                        <th style={{ ...cell, textAlign: 'left' }}>#</th>
                        <th style={{ ...cell, textAlign: 'left' }}>Description</th>
                        <th style={cellRight}>Qty</th>
                        <th style={{ ...cell, textAlign: 'left' }}>Unit</th>
                        <th style={cellRight}>Price</th>
                        <th style={cellRight}>Total</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.length === 0 ? (
                        <tr><td colSpan={6} style={{ ...cell, textAlign: 'center', padding: '10px' }}>No line items.</td></tr>
                    ) : rows.map((row) => (
                        <tr key={row.id}>
                            <td style={cell}>{row.no}</td>
                            <td style={cell}>{row.description}</td>
                            <td style={cellRight}>{row.qty}</td>
                            <td style={cell}>{row.unit}</td>
                            <td style={cellRight}>{formatIDR(row.price)}</td>
                            <td style={cellRight}>{formatIDR(row.total)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>

            <div style={{ marginLeft: 'auto', width: '320px', marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                    <span>Subtotal</span>
                    <strong>{formatIDR(resolvedSubtotal)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                    <span>PPN</span>
                    <strong>{formatIDR(resolvedTax)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid #d1d5db', fontSize: '14px' }}>
                    <span>TOTAL</span>
                    <strong>{formatIDR(resolvedTotal)}</strong>
                </div>
            </div>

            <div style={{ borderTop: '1px solid #d1d5db', paddingTop: '10px' }}>
                <strong>Notes:</strong> {document.reason || document.notes || '-'}
            </div>
        </div>
    );
};

export default NotePrintTemplate;
