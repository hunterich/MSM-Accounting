import React, { useEffect, useMemo, useState } from 'react';
import Modal from '../../components/UI/Modal';
import Button from '../../components/UI/Button';
import { formatIDR } from '../../utils/formatters';
import { useBillablePoLines, type BillablePoLine } from '../../hooks/useAP';

export type PulledBillLine = {
    itemId: string;
    purchaseOrderLineId: string;
    description: string;
    unit: string;
    price: number;
    discount: number;
    qty: number;
};

type Props = {
    isOpen: boolean;
    vendorId: string;
    onClose: () => void;
    onConfirm: (lines: PulledBillLine[]) => void;
};

/**
 * "Ambil dari PO" — pull received-but-unbilled PO lines into a bill. Selected
 * lines carry purchaseOrderLineId so the bill posts Dr GR/IR / Cr AP (inventory
 * was already recognised at goods receipt).
 */
const PullFromPoModal = ({ isOpen, vendorId, onClose, onConfirm }: Props): React.ReactElement => {
    const { data: lines = [], isLoading } = useBillablePoLines(isOpen ? vendorId : undefined);
    const [selected, setSelected] = useState<Record<string, boolean>>({});
    const [qtys, setQtys] = useState<Record<string, number>>({});

    // Default every line to selected at its full billable qty when the list loads.
    useEffect(() => {
        if (!isOpen) return;
        const sel: Record<string, boolean> = {};
        const q: Record<string, number> = {};
        for (const l of lines) { sel[l.poLineId] = true; q[l.poLineId] = l.billableQty; }
        setSelected(sel);
        setQtys(q);
    }, [isOpen, lines]);

    const grouped = useMemo(() => {
        const map = new Map<string, { poNumber: string; lines: BillablePoLine[] }>();
        for (const l of lines) {
            if (!map.has(l.poId)) map.set(l.poId, { poNumber: l.poNumber, lines: [] });
            map.get(l.poId)!.lines.push(l);
        }
        return [...map.values()];
    }, [lines]);

    const confirm = () => {
        const picked: PulledBillLine[] = lines
            .filter((l) => selected[l.poLineId] && l.itemId)
            .map((l) => ({
                itemId: l.itemId as string,
                purchaseOrderLineId: l.poLineId,
                description: l.description,
                unit: l.unit,
                price: l.price,
                discount: l.discountPct,
                qty: Math.min(qtys[l.poLineId] || 0, l.billableQty),
            }))
            .filter((l) => l.qty > 0);
        onConfirm(picked);
        onClose();
    };

    const anySelected = lines.some((l) => selected[l.poLineId] && (qtys[l.poLineId] || 0) > 0);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Ambil dari PO (Pull received goods)" size="lg">
            {isLoading ? (
                <div className="p-6 text-center text-neutral-400">Loading received lines…</div>
            ) : lines.length === 0 ? (
                <div className="p-6 text-center text-neutral-400">
                    No received-but-unbilled PO lines for this vendor.
                </div>
            ) : (
                <div className="flex flex-col gap-4">
                    {grouped.map((g) => (
                        <div key={g.poNumber} className="border border-neutral-200 rounded-lg overflow-hidden">
                            <div className="bg-neutral-50 px-3 py-2 text-sm font-semibold text-neutral-700">PO {g.poNumber}</div>
                            <table className="w-full border-collapse text-sm">
                                <thead>
                                    <tr>
                                        <th className="p-2 w-[5%]"></th>
                                        <th className="text-left p-2 border-b border-neutral-200 text-neutral-600">Item</th>
                                        <th className="text-right p-2 border-b border-neutral-200 text-neutral-600 w-[14%]">Billable</th>
                                        <th className="text-right p-2 border-b border-neutral-200 text-neutral-600 w-[16%]">Qty to bill</th>
                                        <th className="text-right p-2 border-b border-neutral-200 text-neutral-600 w-[16%]">Price</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {g.lines.map((l) => (
                                        <tr key={l.poLineId} className="border-b border-neutral-100">
                                            <td className="p-2 text-center">
                                                <input
                                                    type="checkbox"
                                                    checked={Boolean(selected[l.poLineId])}
                                                    onChange={(e) => setSelected((p) => ({ ...p, [l.poLineId]: e.target.checked }))}
                                                />
                                            </td>
                                            <td className="p-2">
                                                <div className="text-neutral-800">{l.description}</div>
                                                <div className="text-xs text-neutral-400">{l.sku}</div>
                                            </td>
                                            <td className="p-2 text-right text-neutral-600">{l.billableQty} {l.unit}</td>
                                            <td className="p-2 text-right">
                                                <input
                                                    type="number"
                                                    className="w-full min-h-8 px-2 text-sm text-right border border-neutral-300 rounded-md"
                                                    value={qtys[l.poLineId] ?? l.billableQty}
                                                    max={l.billableQty}
                                                    min={0}
                                                    onChange={(e) => setQtys((p) => ({ ...p, [l.poLineId]: Number(e.target.value) }))}
                                                />
                                            </td>
                                            <td className="p-2 text-right text-neutral-700">{formatIDR(l.price)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ))}
                    <div className="flex justify-end gap-2 pt-2">
                        <Button text="Cancel" variant="secondary" onClick={onClose} />
                        <Button text="Add selected lines" variant="primary" onClick={confirm} disabled={!anySelected} />
                    </div>
                </div>
            )}
        </Modal>
    );
};

export default PullFromPoModal;
