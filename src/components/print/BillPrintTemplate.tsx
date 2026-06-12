import React from 'react';
import { formatIDR } from '../../utils/formatters';
import {
    CompanyBlock, Letterhead, DocumentFooter, SignatureBlock,
    pageStyle, cellStyle, cellRightStyle, titleStyle, tableHeadCellStyle, totalAccent,
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

interface RawLineItem {
    id?: string;
    description?: string;
    qty?: number | string;
    quantity?: number | string;
    unit?: string;
    price?: number | string;
    [key: string]: unknown;
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
    const description = line.description || '-';
    const qty = toNumber(line.qty ?? line.quantity);
    const unit = line.unit || 'PCS';
    const price = toNumber(line.price);
    const total = qty * price;

    return {
        id: line.id || `${description}-${index + 1}`,
        no: index + 1,
        description,
        qty,
        unit,
        price,
        total,
    };
};

interface BillRecord {
    id?: string;
    vendor?: string;
    date?: string;
    due?: string;
    status?: string;
    poNumber?: string;
    amount?: number | string;
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
    [key: string]: unknown;
}

interface BillPrintTemplateProps {
    bill?: BillRecord | null;
    lineItems?: RawLineItem[];
    company?: CompanyInfo;
    options?: PrintOptions;
}

const BillPrintTemplate: React.FC<BillPrintTemplateProps> = ({ bill, lineItems = [], company = {}, options = DEFAULT_PRINT_OPTIONS }) => {
    if (!bill) {
        return <div className="print-template" style={pageStyle(options)}>No bill selected.</div>;
    }

    const rows = lineItems.map(normalizeLine);
    const subtotal = rows.reduce((sum, row) => sum + row.total, 0);
    const totalAmount = subtotal > 0 ? subtotal : toNumber(bill.amount);
    const showUnit = options.showUnitColumn;
    const colSpan = 4 + (showUnit ? 1 : 0);

    return (
        <div className="print-template" style={pageStyle(options)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <CompanyBlock company={company} showLogo={options.showLogo} />
                <div style={{ textAlign: 'right' }}>
                    <h2 style={titleStyle(options)}>BILL</h2>
                </div>
            </div>
            <Letterhead options={options} />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', border: '1px solid #d1d5db', marginBottom: '14px' }}>
                <div style={{ padding: '10px', borderRight: '1px solid #d1d5db' }}>
                    <div style={{ fontWeight: 600, marginBottom: '6px' }}>Vendor:</div>
                    <div>{bill.vendor || '-'}</div>
                </div>
                <div style={{ padding: '10px' }}>
                    <div><strong>Bill #:</strong> {bill.id}</div>
                    <div><strong>Date:</strong> {formatLongDate(bill.date)}</div>
                    <div><strong>Due:</strong> {formatLongDate(bill.due)}</div>
                    <div><strong>Status:</strong> {bill.status || '-'}</div>
                    {bill.poNumber ? <div><strong>PO #:</strong> {bill.poNumber}</div> : null}
                </div>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '14px' }}>
                <thead>
                    <tr>
                        <th style={tableHeadCellStyle(options, 'left')}>#</th>
                        <th style={tableHeadCellStyle(options, 'left')}>Description</th>
                        <th style={tableHeadCellStyle(options, 'right')}>Qty</th>
                        {showUnit ? <th style={tableHeadCellStyle(options, 'left')}>Unit</th> : null}
                        <th style={tableHeadCellStyle(options, 'right')}>Price</th>
                        <th style={tableHeadCellStyle(options, 'right')}>Total</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.length === 0 ? (
                        <tr>
                            <td colSpan={colSpan} style={{ ...cellStyle(options), textAlign: 'center', padding: '10px' }}>No line items.</td>
                        </tr>
                    ) : rows.map((row) => (
                        <tr key={row.id}>
                            <td style={cellStyle(options)}>{row.no}</td>
                            <td style={cellStyle(options)}>{row.description}</td>
                            <td style={cellRightStyle(options)}>{row.qty}</td>
                            {showUnit ? <td style={cellStyle(options)}>{row.unit}</td> : null}
                            <td style={cellRightStyle(options)}>{formatIDR(row.price)}</td>
                            <td style={cellRightStyle(options)}>{formatIDR(row.total)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>

            <div style={{ marginLeft: 'auto', width: '320px', marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: `2px solid ${totalAccent(options)}`, fontSize: '14px', color: totalAccent(options) }}>
                    <span>TOTAL</span>
                    <strong>{formatIDR(totalAmount)}</strong>
                </div>
            </div>

            <div style={{ borderTop: '1px solid #d1d5db', paddingTop: '10px' }}>
                <strong>Notes:</strong> {bill.notes || '-'}
            </div>

            <DocumentFooter options={options} />
            <SignatureBlock options={options} />
        </div>
    );
};

export default BillPrintTemplate;
