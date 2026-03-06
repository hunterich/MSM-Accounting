import React from 'react';
import { formatIDR } from '../../utils/formatters';

const mm = (value) => `${value}mm`;

const basePageStyle = {
    width: mm(210),
    minHeight: mm(297),
    padding: mm(20),
    background: '#fff',
    color: '#111827',
    fontFamily: 'Inter, Arial, sans-serif',
    fontSize: '12px',
};

const formatLongDate = (value) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    }).format(date);
};

const toNumber = (value) => {
    const num = Number(value || 0);
    return Number.isFinite(num) ? num : 0;
};

const normalizeLine = (line, index) => {
    const description = line.description || line.itemName || line.name || '-';
    const qty = toNumber(line.qty ?? line.quantity);
    const unit = line.unit || 'PCS';
    const price = toNumber(line.price);
    const discount = toNumber(line.discount ?? line.discountPct);
    const gross = qty * price;
    const discountAmount = gross * (discount / 100);
    const total = gross - discountAmount;

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

const SalesOrderPrintTemplate = ({ salesOrder, lineItems = [], company = {} }) => {
    if (!salesOrder) {
        return <div className="print-template" style={basePageStyle}>No sales order selected.</div>;
    }

    const rows = lineItems.map(normalizeLine);
    const subtotalFromRows = rows.reduce((sum, row) => sum + row.total, 0);
    const totalAmount = subtotalFromRows > 0 ? subtotalFromRows : toNumber(salesOrder.amount);

    return (
        <div className="print-template" style={basePageStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '18px' }}>
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
                    <h2 style={{ margin: 0, fontSize: '28px', letterSpacing: '0.04em' }}>SALES ORDER</h2>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', border: '1px solid #d1d5db', marginBottom: '14px' }}>
                <div style={{ padding: '10px', borderRight: '1px solid #d1d5db' }}>
                    <div style={{ fontWeight: 600, marginBottom: '6px' }}>Customer:</div>
                    <div>{salesOrder.customerName || '-'}</div>
                </div>
                <div style={{ padding: '10px' }}>
                    <div><strong>SO #:</strong> {salesOrder.id}</div>
                    <div><strong>Date:</strong> {formatLongDate(salesOrder.date)}</div>
                    <div><strong>Expected Delivery Date:</strong> {formatLongDate(salesOrder.expectedDate)}</div>
                    <div><strong>Status:</strong> {salesOrder.status || '-'}</div>
                </div>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '14px' }}>
                <thead>
                    <tr>
                        <th style={{ border: '1px solid #d1d5db', padding: '6px', textAlign: 'left' }}>#</th>
                        <th style={{ border: '1px solid #d1d5db', padding: '6px', textAlign: 'left' }}>Description</th>
                        <th style={{ border: '1px solid #d1d5db', padding: '6px', textAlign: 'right' }}>Qty</th>
                        <th style={{ border: '1px solid #d1d5db', padding: '6px', textAlign: 'left' }}>Unit</th>
                        <th style={{ border: '1px solid #d1d5db', padding: '6px', textAlign: 'right' }}>Price</th>
                        <th style={{ border: '1px solid #d1d5db', padding: '6px', textAlign: 'right' }}>Total</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.length === 0 ? (
                        <tr>
                            <td colSpan={6} style={{ border: '1px solid #d1d5db', padding: '10px', textAlign: 'center' }}>No line items.</td>
                        </tr>
                    ) : rows.map((row) => (
                        <tr key={row.id}>
                            <td style={{ border: '1px solid #d1d5db', padding: '6px' }}>{row.no}</td>
                            <td style={{ border: '1px solid #d1d5db', padding: '6px' }}>{row.description}</td>
                            <td style={{ border: '1px solid #d1d5db', padding: '6px', textAlign: 'right' }}>{row.qty}</td>
                            <td style={{ border: '1px solid #d1d5db', padding: '6px' }}>{row.unit}</td>
                            <td style={{ border: '1px solid #d1d5db', padding: '6px', textAlign: 'right' }}>{formatIDR(row.price)}</td>
                            <td style={{ border: '1px solid #d1d5db', padding: '6px', textAlign: 'right' }}>{formatIDR(row.total)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>

            <div style={{ marginLeft: 'auto', width: '320px', marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid #d1d5db', fontSize: '14px' }}>
                    <span>TOTAL</span>
                    <strong>{formatIDR(totalAmount)}</strong>
                </div>
            </div>

            <div style={{ borderTop: '1px solid #d1d5db', paddingTop: '10px' }}>
                <strong>Notes:</strong> {salesOrder.notes || '-'}
            </div>
        </div>
    );
};

export default SalesOrderPrintTemplate;
