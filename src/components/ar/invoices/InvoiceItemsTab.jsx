import React from 'react';
import { formatIDR } from '../../../utils/formatters';
import { useInvoiceStore } from '../../../stores/useInvoiceStore';

const InvoiceItemsTab = ({ invoice }) => {
    const invoiceItemTemplates = useInvoiceStore((state) => state.invoiceItemTemplates);
    const templateLines = invoiceItemTemplates[invoice.id] || [];
    const lines = (invoice.items && invoice.items.length > 0) ? invoice.items : templateLines;

    const normalizeLine = (line) => ({
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
            <div className="max-h-[300px] overflow-auto border border-neutral-200 rounded-lg">
                <table className="w-full border-collapse text-[0.9rem]">
                    <thead>
                        <tr>
                            <th className="py-[9px] px-2.5 text-left font-semibold text-neutral-700 border-b border-neutral-200 bg-neutral-100 sticky top-0 z-[1]">Item</th>
                            <th className="py-[9px] px-2.5 text-right font-semibold text-neutral-700 border-b border-neutral-200 bg-neutral-100 sticky top-0 z-[1]">Qty</th>
                            <th className="py-[9px] px-2.5 text-left font-semibold text-neutral-700 border-b border-neutral-200 bg-neutral-100 sticky top-0 z-[1]">Unit</th>
                            <th className="py-[9px] px-2.5 text-right font-semibold text-neutral-700 border-b border-neutral-200 bg-neutral-100 sticky top-0 z-[1]">Price</th>
                            <th className="py-[9px] px-2.5 text-right font-semibold text-neutral-700 border-b border-neutral-200 bg-neutral-100 sticky top-0 z-[1]">Disc %</th>
                            <th className="py-[9px] px-2.5 text-right font-semibold text-neutral-700 border-b border-neutral-200 bg-neutral-100 sticky top-0 z-[1]">Line Total</th>
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
                                    <td className="py-[9px] px-2.5 border-b border-neutral-200">{line.description}</td>
                                    <td className="py-[9px] px-2.5 border-b border-neutral-200 text-right">{line.quantity}</td>
                                    <td className="py-[9px] px-2.5 border-b border-neutral-200">{line.unit}</td>
                                    <td className="py-[9px] px-2.5 border-b border-neutral-200 text-right">{formatIDR(line.price)}</td>
                                    <td className="py-[9px] px-2.5 border-b border-neutral-200 text-right">{line.discount || 0}</td>
                                    <td className="py-[9px] px-2.5 border-b border-neutral-200 text-right">{formatIDR(total)}</td>
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
