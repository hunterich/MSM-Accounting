import React from 'react';

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

interface DeliveryNoteLine {
    itemId?: string;
    description?: string;
    itemName?: string;
    qtyOrdered?: number | string;
    qtyToDeliver?: number | string;
    unit?: string;
}

interface DeliveryNoteRecord {
    id?: string;
    number?: string;
    salesOrderNumber?: string;
    salesOrderId?: string;
    customerName?: string;
    date?: string;
    warehouseName?: string;
    status?: string;
    notes?: string;
    lines?: DeliveryNoteLine[];
}

interface CompanyInfo {
    logoUrl?: string;
    companyName?: string;
    address?: string;
    phone?: string;
    email?: string;
    npwp?: string;
}

interface DeliveryNotePrintTemplateProps {
    deliveryNote?: DeliveryNoteRecord | null;
    company?: CompanyInfo;
}

const cell: React.CSSProperties = { border: '1px solid #d1d5db', padding: '6px' };
const cellRight: React.CSSProperties = { ...cell, textAlign: 'right' };

const SignatureBlock: React.FC<{ label: string }> = ({ label }) => (
    <div style={{ width: '180px', textAlign: 'center' }}>
        <div style={{ marginBottom: '48px' }}>{label}</div>
        <div style={{ borderTop: '1px solid #111827', paddingTop: '4px' }}>(&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;)</div>
    </div>
);

const DeliveryNotePrintTemplate: React.FC<DeliveryNotePrintTemplateProps> = ({ deliveryNote, company = {} }) => {
    if (!deliveryNote) {
        return <div className="print-template" style={basePageStyle}>No delivery note selected.</div>;
    }

    const lines = deliveryNote.lines || [];
    const docNo = deliveryNote.number || deliveryNote.id || '-';
    const soRef = deliveryNote.salesOrderNumber || deliveryNote.salesOrderId || '-';

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
                    <h2 style={{ margin: 0, fontSize: '24px', letterSpacing: '0.04em' }}>DELIVERY NOTE</h2>
                    <div style={{ fontSize: '13px', color: '#6b7280' }}>SURAT JALAN</div>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', border: '1px solid #d1d5db', marginBottom: '14px' }}>
                <div style={{ padding: '10px', borderRight: '1px solid #d1d5db' }}>
                    <div style={{ fontWeight: 600, marginBottom: '6px' }}>Deliver To:</div>
                    <div>{deliveryNote.customerName || '-'}</div>
                </div>
                <div style={{ padding: '10px' }}>
                    <div><strong>DN #:</strong> {docNo}</div>
                    <div><strong>Date:</strong> {formatLongDate(deliveryNote.date)}</div>
                    <div><strong>SO Ref:</strong> {soRef}</div>
                    <div><strong>Warehouse:</strong> {deliveryNote.warehouseName || '-'}</div>
                    <div><strong>Status:</strong> {deliveryNote.status || '-'}</div>
                </div>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '24px' }}>
                <thead>
                    <tr>
                        <th style={{ ...cell, textAlign: 'left' }}>#</th>
                        <th style={{ ...cell, textAlign: 'left' }}>Description</th>
                        <th style={cellRight}>Qty Ordered</th>
                        <th style={cellRight}>Qty Delivered</th>
                        <th style={{ ...cell, textAlign: 'left' }}>Unit</th>
                    </tr>
                </thead>
                <tbody>
                    {lines.length === 0 ? (
                        <tr><td colSpan={5} style={{ ...cell, textAlign: 'center', padding: '10px' }}>No line items.</td></tr>
                    ) : lines.map((line, index) => (
                        <tr key={line.itemId || `${line.description}-${index}`}>
                            <td style={cell}>{index + 1}</td>
                            <td style={cell}>{line.description || line.itemName || '-'}</td>
                            <td style={cellRight}>{toNumber(line.qtyOrdered)}</td>
                            <td style={cellRight}>{toNumber(line.qtyToDeliver)}</td>
                            <td style={cell}>{line.unit || 'PCS'}</td>
                        </tr>
                    ))}
                </tbody>
            </table>

            {deliveryNote.notes ? (
                <div style={{ borderTop: '1px solid #d1d5db', paddingTop: '10px', marginBottom: '24px' }}>
                    <strong>Notes:</strong> {deliveryNote.notes}
                </div>
            ) : null}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '40px' }}>
                <SignatureBlock label="Delivered By" />
                <SignatureBlock label="Received By" />
            </div>
        </div>
    );
};

export default DeliveryNotePrintTemplate;
