import React from 'react';
import { formatIDR } from '../../../utils/formatters';

interface RawLineItem {
    id?: string;
    description?: string;
    itemName?: string;
    quantity?: number | string;
    qty?: number | string;
    unit?: string;
    price?: number | string;
    discount?: number | string;
    discountPct?: number | string;
    [key: string]: unknown;
}

interface NormalizedLine {
    id: string;
    description: string;
    quantity: number;
    unit: string;
    price: number;
    discount: number;
}

interface InvoiceRecord {
    id: string;
    items?: RawLineItem[];
    [key: string]: unknown;
}

interface InvoiceItemsTabProps {
    invoice: InvoiceRecord;
}

const InvoiceItemsTab: React.FC<InvoiceItemsTabProps> = ({ invoice }) => {
    // `items` is normalized from the invoice's own API lines. The fallback here
    // used to be a local fixture keyed by invoice id, which no real invoice's id
    // ever matched — it could only ever have shown another company's lines.
    const lines = invoice.items ?? [];

    const normalizeLine = (line: RawLineItem): NormalizedLine => ({
        id: line.id || `${line.description || line.itemName || 'line'}`,
        description: line.description || line.itemName || '-',
        quantity: Number(line.quantity ?? line.qty ?? 0),
        unit: line.unit || 'PCS',
        price: Number(line.price || 0),
        discount: Number(line.discount ?? line.discountPct ?? 0),
    });

    const normalizedLines = lines.map(normalizeLine);
    const subtotal = normalizedLines.reduce((sum, line) => {
        const gross = Number(line.quantity || 0) * Number(line.price || 0);
        const discount = gross * (Number(line.discount || 0) / 100);
        return sum + (gross - discount);
    }, 0);

    return (
        <div>
            <div className="workbench-scroll-table">
                <table className="invoice-workbench-table">
                    <thead>
                        <tr>
                            <th>Item</th>
                            <th className="text-right">Qty</th>
                            <th>Unit</th>
                            <th className="text-right">Price</th>
                            <th className="text-right">Disc %</th>
                            <th className="text-right">Line Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        {normalizedLines.length === 0 && (
                            <tr>
                                <td colSpan={6} className="text-center text-neutral-600 p-5">
                                    No line items.
                                </td>
                            </tr>
                        )}
                        {normalizedLines.map((line) => {
                            const gross = Number(line.quantity || 0) * Number(line.price || 0);
                            const disc = gross * (Number(line.discount || 0) / 100);
                            const total = gross - disc;
                            return (
                                <tr key={line.id}>
                                    <td>{line.description}</td>
                                    <td className="text-right">{line.quantity}</td>
                                    <td>{line.unit}</td>
                                    <td className="text-right">{formatIDR(line.price)}</td>
                                    <td className="text-right">{line.discount || 0}</td>
                                    <td className="text-right">{formatIDR(total)}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <div className="mt-2.5 flex justify-end gap-3 items-center text-base">
                <span>Total</span>
                <strong>{formatIDR(subtotal)}</strong>
            </div>
        </div>
    );
};

export default InvoiceItemsTab;
