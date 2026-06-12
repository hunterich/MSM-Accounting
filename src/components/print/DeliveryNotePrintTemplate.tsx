import React from 'react';
import {
    CompanyBlock, Letterhead, DocumentFooter,
    pageStyle, cellStyle, cellRightStyle, titleStyle, tableHeadCellStyle,
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
    options?: PrintOptions;
}

// A delivery note (surat jalan) always carries delivered-by / received-by signatures.
const PartySignature: React.FC<{ label: string }> = ({ label }) => (
    <div style={{ width: '180px', textAlign: 'center' }}>
        <div style={{ marginBottom: '48px' }}>{label}</div>
        <div style={{ borderTop: '1px solid #111827', paddingTop: '4px' }}>(&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;)</div>
    </div>
);

const DeliveryNotePrintTemplate: React.FC<DeliveryNotePrintTemplateProps> = ({ deliveryNote, company = {}, options = DEFAULT_PRINT_OPTIONS }) => {
    if (!deliveryNote) {
        return <div className="print-template" style={pageStyle(options)}>No delivery note selected.</div>;
    }

    const lines = deliveryNote.lines || [];
    const docNo = deliveryNote.number || deliveryNote.id || '-';
    const soRef = deliveryNote.salesOrderNumber || deliveryNote.salesOrderId || '-';
    const showUnit = options.showUnitColumn;
    const colSpan = 4 + (showUnit ? 1 : 0);

    return (
        <div className="print-template" style={pageStyle(options)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <CompanyBlock company={company} showLogo={options.showLogo} />
                <div style={{ textAlign: 'right' }}>
                    <h2 style={titleStyle(options)}>DELIVERY NOTE</h2>
                    <div style={{ fontSize: '13px', color: '#6b7280' }}>SURAT JALAN</div>
                </div>
            </div>
            <Letterhead options={options} />

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
                        <th style={tableHeadCellStyle(options, 'left')}>#</th>
                        <th style={tableHeadCellStyle(options, 'left')}>Description</th>
                        <th style={tableHeadCellStyle(options, 'right')}>Qty Ordered</th>
                        <th style={tableHeadCellStyle(options, 'right')}>Qty Delivered</th>
                        {showUnit ? <th style={tableHeadCellStyle(options, 'left')}>Unit</th> : null}
                    </tr>
                </thead>
                <tbody>
                    {lines.length === 0 ? (
                        <tr><td colSpan={colSpan} style={{ ...cellStyle(options), textAlign: 'center', padding: '10px' }}>No line items.</td></tr>
                    ) : lines.map((line, index) => (
                        <tr key={line.itemId || `${line.description}-${index}`}>
                            <td style={cellStyle(options)}>{index + 1}</td>
                            <td style={cellStyle(options)}>{line.description || line.itemName || '-'}</td>
                            <td style={cellRightStyle(options)}>{toNumber(line.qtyOrdered)}</td>
                            <td style={cellRightStyle(options)}>{toNumber(line.qtyToDeliver)}</td>
                            {showUnit ? <td style={cellStyle(options)}>{line.unit || 'PCS'}</td> : null}
                        </tr>
                    ))}
                </tbody>
            </table>

            {deliveryNote.notes ? (
                <div style={{ borderTop: '1px solid #d1d5db', paddingTop: '10px', marginBottom: '24px' }}>
                    <strong>Notes:</strong> {deliveryNote.notes}
                </div>
            ) : null}

            <DocumentFooter options={options} />

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '40px' }}>
                <PartySignature label="Delivered By" />
                <PartySignature label="Received By" />
            </div>
        </div>
    );
};

export default DeliveryNotePrintTemplate;
