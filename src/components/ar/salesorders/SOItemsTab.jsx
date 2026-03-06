import React from 'react';
import { formatIDR } from '../../../utils/formatters';

const normalizeLine = (line) => {
    const quantity = Number(line.qty ?? line.quantity ?? 0);
    const price = Number(line.price || 0);
    const discount = Number(line.discount ?? line.discountPct ?? 0);
    const gross = quantity * price;
    const total = gross - (gross * (discount / 100));

    return {
        id: line.id || `${line.description || line.itemName || 'line'}`,
        description: line.description || line.itemName || '-',
        quantity,
        unit: line.unit || 'PCS',
        price,
        discount,
        total,
    };
};

const SOItemsTab = ({ lineItems = [] }) => {
    const rows = lineItems.map(normalizeLine);
    const subtotal = rows.reduce((sum, row) => sum + row.total, 0);

    return (
        <div>
            <div className="max-h-[300px] overflow-auto border border-neutral-200 rounded-lg">
                <table className="w-full border-collapse text-[0.9rem]">
                    <thead>
                        <tr>
                            <th className="py-[9px] px-2.5 text-left font-semibold text-neutral-700 border-b border-neutral-200 bg-neutral-100 sticky top-0 z-[1]">Description</th>
                            <th className="py-[9px] px-2.5 text-right font-semibold text-neutral-700 border-b border-neutral-200 bg-neutral-100 sticky top-0 z-[1]">Qty</th>
                            <th className="py-[9px] px-2.5 text-left font-semibold text-neutral-700 border-b border-neutral-200 bg-neutral-100 sticky top-0 z-[1]">Unit</th>
                            <th className="py-[9px] px-2.5 text-right font-semibold text-neutral-700 border-b border-neutral-200 bg-neutral-100 sticky top-0 z-[1]">Price</th>
                            <th className="py-[9px] px-2.5 text-right font-semibold text-neutral-700 border-b border-neutral-200 bg-neutral-100 sticky top-0 z-[1]">Disc %</th>
                            <th className="py-[9px] px-2.5 text-right font-semibold text-neutral-700 border-b border-neutral-200 bg-neutral-100 sticky top-0 z-[1]">Line Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 && (
                            <tr>
                                <td colSpan={6} className="text-center text-neutral-600 p-5">No line items.</td>
                            </tr>
                        )}
                        {rows.map((line) => (
                            <tr key={line.id}>
                                <td className="py-[9px] px-2.5 border-b border-neutral-200">{line.description}</td>
                                <td className="py-[9px] px-2.5 border-b border-neutral-200 text-right">{line.quantity}</td>
                                <td className="py-[9px] px-2.5 border-b border-neutral-200">{line.unit}</td>
                                <td className="py-[9px] px-2.5 border-b border-neutral-200 text-right">{formatIDR(line.price)}</td>
                                <td className="py-[9px] px-2.5 border-b border-neutral-200 text-right">{line.discount}</td>
                                <td className="py-[9px] px-2.5 border-b border-neutral-200 text-right">{formatIDR(line.total)}</td>
                            </tr>
                        ))}
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

export default SOItemsTab;
