import React, { useMemo, useState } from 'react';
import Card from '../../components/UI/Card';
import Table, { TableColumn } from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import StatusTag from '../../components/UI/StatusTag';
import Modal from '../../components/UI/Modal';
import ListPage from '../../components/Layout/ListPage';
import { Plus, Search } from 'lucide-react';
import { formatDateID } from '../../utils/formatters';
import { useDeliveryNotes, useCreateDeliveryNote, DeliveryNote, DeliveryNoteLine } from '../../hooks/useAR';
import { useSalesOrders } from '../../hooks/useAR';
import { useWarehouses } from '../../hooks/useInventory';
import { useModulePermissions } from '../../hooks/useModulePermissions';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DNFormState {
    salesOrderId: string;
    date: string;
    warehouseId: string;
    notes: string;
    status: 'Draft' | 'Delivered';
    lines: DeliveryNoteLine[];
}

// ── Status badge helper ───────────────────────────────────────────────────────

const dnStatusVariant = (status: string): string => {
    if (status === 'Delivered') return 'Success';
    if (status === 'Cancelled') return 'Danger';
    return 'neutral';
};

// ── Main component ────────────────────────────────────────────────────────────

const DeliveryNotes: React.FC = () => {
    const { canCreate } = useModulePermissions('ar_sales_orders');

    // ── filters ────────────────────────────────────────────────────────────────
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('');

    // ── data ───────────────────────────────────────────────────────────────────
    const { data: dnResult, isLoading } = useDeliveryNotes({});
    const notes: DeliveryNote[] = dnResult?.data ?? [];

    const { data: soResult } = useSalesOrders({ status: 'open', limit: 200 });
    const openSOs = soResult?.data ?? [];

    const warehouses = useWarehouses().data ?? [];

    const createDN = useCreateDeliveryNote();

    // ── modal state ────────────────────────────────────────────────────────────
    const [modalOpen, setModalOpen] = useState(false);
    const [form, setForm] = useState<DNFormState>({
        salesOrderId: '',
        date: new Date().toISOString().slice(0, 10),
        warehouseId: '',
        notes: '',
        status: 'Draft',
        lines: [],
    });
    const [saveError, setSaveError] = useState('');

    // ── filtered list ──────────────────────────────────────────────────────────
    const filtered = useMemo(() => {
        const kw = searchTerm.toLowerCase();
        return notes.filter((n) => {
            const matchesSearch =
                (n.id || '').toLowerCase().includes(kw) ||
                (n.salesOrderNumber || '').toLowerCase().includes(kw) ||
                (n.customerName || '').toLowerCase().includes(kw);
            const matchesStatus = statusFilter ? n.status === statusFilter : true;
            return matchesSearch && matchesStatus;
        });
    }, [notes, searchTerm, statusFilter]);

    // ── populate SO lines when SO is selected ──────────────────────────────────
    const handleSOChange = (soId: string) => {
        const so = openSOs.find((s) => s.id === soId);
        const lines: DeliveryNoteLine[] = (so?.items ?? []).map((item) => ({
            itemId: item.productId || item.id || '',
            description: item.description ?? '',
            qtyOrdered: item.quantity,
            qtyToDeliver: item.quantity,
            unit: item.unit,
        }));
        setForm((prev) => ({ ...prev, salesOrderId: soId, lines }));
    };

    // ── form handlers ──────────────────────────────────────────────────────────
    const handleLineQtyChange = (index: number, qty: number) => {
        setForm((prev) => {
            const lines = [...prev.lines];
            lines[index] = { ...lines[index], qtyToDeliver: qty };
            return { ...prev, lines };
        });
    };

    const handleSubmit = async () => {
        if (!form.salesOrderId) { setSaveError('Sales Order is required.'); return; }
        if (!form.date) { setSaveError('Date is required.'); return; }
        setSaveError('');
        try {
            await createDN.mutateAsync(form);
            setModalOpen(false);
            setForm({
                salesOrderId: '',
                date: new Date().toISOString().slice(0, 10),
                warehouseId: '',
                notes: '',
                status: 'Draft',
                lines: [],
            });
        } catch (err) {
            setSaveError((err as Error)?.message ?? 'Failed to create delivery note.');
        }
    };

    // ── columns ────────────────────────────────────────────────────────────────
    const columns: TableColumn<Record<string, unknown>>[] = [
        { key: 'id', label: 'Number', sortable: true },
        { key: 'salesOrderNumber', label: 'Sales Order #', sortable: true },
        { key: 'customerName', label: 'Customer', sortable: true },
        { key: 'date', label: 'Date', sortable: true, render: (val) => formatDateID(val as string) },
        { key: 'warehouseName', label: 'Warehouse' },
        { key: 'status', label: 'Status', render: (val) => <StatusTag status={dnStatusVariant(val as string)} label={val as string} /> },
        { key: 'lines', label: 'Items', align: 'right', render: (val) => Array.isArray(val) ? String(val.length) : '—' },
    ];

    return (
        <ListPage
            title="Delivery Notes"
            subtitle="Track goods dispatched to customers."
            actions={
                <Button
                    text="New Delivery Note"
                    variant="primary"
                    icon={<Plus size={16} />}
                    disabled={!canCreate}
                    onClick={() => setModalOpen(true)}
                />
            }
        >
            {/* Filter bar */}
            <div className="grid grid-cols-[1fr_200px] gap-2.5 items-center bg-neutral-0 border border-neutral-200 rounded-lg p-3 mb-4">
                <div className="relative flex items-center">
                    <Search size={16} className="absolute left-2.5 text-neutral-400" />
                    <input
                        type="text"
                        className="block w-full pl-[34px] px-3 text-sm text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0"
                        placeholder="Search by number, SO, or customer..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <select
                    className="block w-full px-3 text-sm text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                >
                    <option value="">All Statuses</option>
                    <option value="Draft">Draft</option>
                    <option value="Delivered">Delivered</option>
                    <option value="Cancelled">Cancelled</option>
                </select>
            </div>

            <Card padding={false}>
                <Table
                    columns={columns}
                    data={filtered as unknown as Record<string, unknown>[]}
                    isLoading={isLoading}
                    loadingLabel="Loading delivery notes..."
                    showCount
                    countLabel="delivery notes"
                />
            </Card>

            {/* Create modal */}
            <Modal
                isOpen={modalOpen}
                onClose={() => setModalOpen(false)}
                title="New Delivery Note"
                size="lg"
            >
                <div className="space-y-4">
                    {saveError && (
                        <div className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">
                            {saveError}
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="form-label">Sales Order *</label>
                            <select
                                className="block w-full px-3 text-sm text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0"
                                value={form.salesOrderId}
                                onChange={(e) => handleSOChange(e.target.value)}
                            >
                                <option value="">Select Sales Order</option>
                                {openSOs.map((so) => (
                                    <option key={so.id} value={so.id}>
                                        {so.number || so.id} — {so.customerName || ''}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="form-label">Date *</label>
                            <input
                                type="date"
                                className="block w-full px-3 text-sm text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0"
                                value={form.date}
                                onChange={(e) => setForm((prev) => ({ ...prev, date: e.target.value }))}
                            />
                        </div>
                    </div>

                    <div>
                        <label className="form-label">Warehouse (optional)</label>
                        <select
                            className="block w-full px-3 text-sm text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0"
                            value={form.warehouseId}
                            onChange={(e) => setForm((prev) => ({ ...prev, warehouseId: e.target.value }))}
                        >
                            <option value="">No specific warehouse</option>
                            {warehouses.map((wh) => (
                                <option key={wh.id} value={wh.id}>{wh.name}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="form-label">Notes</label>
                        <textarea
                            className="block w-full px-3 py-2 text-sm text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md focus:border-primary-500 focus:outline-0 resize-none"
                            rows={2}
                            value={form.notes}
                            onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                        />
                    </div>

                    <div>
                        <label className="form-label">Status</label>
                        <div className="flex gap-4 text-sm">
                            {(['Draft', 'Delivered'] as const).map((s) => (
                                <label key={s} className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="dn-status"
                                        value={s}
                                        checked={form.status === s}
                                        onChange={() => setForm((prev) => ({ ...prev, status: s }))}
                                    />
                                    {s}
                                </label>
                            ))}
                        </div>
                    </div>

                    {form.lines.length > 0 && (
                        <div>
                            <label className="form-label">Line Items</label>
                            <div className="border border-neutral-200 rounded-lg overflow-hidden">
                                <table className="w-full text-sm">
                                    <thead className="bg-neutral-50">
                                        <tr>
                                            <th className="p-2 text-left text-xs font-semibold text-neutral-600">Item</th>
                                            <th className="p-2 text-right text-xs font-semibold text-neutral-600 w-[100px]">Ordered</th>
                                            <th className="p-2 text-right text-xs font-semibold text-neutral-600 w-[110px]">Deliver</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {form.lines.map((line, idx) => (
                                            <tr key={idx} className="border-t border-neutral-100">
                                                <td className="p-2 text-neutral-800">{line.description || line.itemId}</td>
                                                <td className="p-2 text-right text-neutral-600">{line.qtyOrdered} {line.unit}</td>
                                                <td className="p-2">
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        max={line.qtyOrdered}
                                                        className="w-full px-2 text-right border border-neutral-300 rounded h-8 text-sm focus:border-primary-500 focus:outline-0"
                                                        value={line.qtyToDeliver}
                                                        onChange={(e) => handleLineQtyChange(idx, Number(e.target.value))}
                                                    />
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    <div className="flex justify-end gap-2 pt-2">
                        <Button text="Cancel" variant="secondary" onClick={() => setModalOpen(false)} />
                        <Button
                            text={createDN.isPending ? 'Saving...' : 'Create Delivery Note'}
                            variant="primary"
                            onClick={handleSubmit}
                            disabled={createDN.isPending}
                        />
                    </div>
                </div>
            </Modal>
        </ListPage>
    );
};

export default DeliveryNotes;
