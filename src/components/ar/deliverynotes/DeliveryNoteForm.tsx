// src/components/ar/deliverynotes/DeliveryNoteForm.tsx
// Create-form for a delivery note (the pre-workspace path used a modal in
// the Delivery Notes list). Opened as a doc-form tab; saving closes the tab.
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FormPage from '../../Layout/FormPage';
import Button from '../../UI/Button';
import { useCreateDeliveryNote, useSalesOrders, type DeliveryNoteLine } from '../../../hooks/useAR';
import { useWarehouses } from '../../../hooks/useInventory';
import { useWorkspaceStore } from '../../../stores/useWorkspaceStore';

interface DNFormState { salesOrderId: string; date: string; warehouseId: string; notes: string; status: 'Draft' | 'Delivered'; lines: DeliveryNoteLine[] }

interface Props { workspaceTabId: string }

const DeliveryNoteForm = ({ workspaceTabId }: Props): React.ReactElement => {
    const navigate = useNavigate();
    const closeTab = useWorkspaceStore((s) => s.closeTab);
    const createDN = useCreateDeliveryNote();
    const { data: soResult } = useSalesOrders({ status: 'open', limit: 200 });
    const openSOs = soResult?.data ?? [];
    const warehouses = useWarehouses().data ?? [];

    const [form, setForm] = useState<DNFormState>({ salesOrderId: '', date: new Date().toISOString().slice(0, 10), warehouseId: '', notes: '', status: 'Draft', lines: [] });
    const [saveError, setSaveError] = useState('');

    const handleSOChange = (soId: string) => {
        const so = openSOs.find((s) => s.id === soId);
        const lines: DeliveryNoteLine[] = (so?.items ?? []).map((item) => ({ itemId: item.productId || item.id || '', description: item.description ?? '', qtyOrdered: item.quantity, qtyToDeliver: item.quantity, unit: item.unit }));
        setForm((prev) => ({ ...prev, salesOrderId: soId, lines }));
    };
    const handleLineQtyChange = (index: number, qty: number) => setForm((prev) => { const lines = [...prev.lines]; lines[index] = { ...lines[index], qtyToDeliver: qty }; return { ...prev, lines }; });

    const close = () => { closeTab(workspaceTabId); navigate('/ar/delivery-notes'); };
    const handleSubmit = async () => {
        if (!form.salesOrderId) { setSaveError('Sales Order is required.'); return; }
        if (!form.date) { setSaveError('Date is required.'); return; }
        setSaveError('');
        try { await createDN.mutateAsync(form); close(); }
        catch (err) { setSaveError((err as Error)?.message ?? 'Failed to create delivery note.'); }
    };

    return (
        <FormPage title="New Delivery Note" backTo="/ar/delivery-notes" backLabel="Back to Delivery Notes">
            <div className="space-y-4 max-w-3xl">
                {saveError && <div className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">{saveError}</div>}
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="form-label">Sales Order *</label>
                        <select className="block w-full px-3 text-sm text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0" value={form.salesOrderId} onChange={(e) => handleSOChange(e.target.value)}>
                            <option value="">Select Sales Order</option>
                            {openSOs.map((so) => <option key={so.id} value={so.id}>{so.number || so.id} — {so.customerName || ''}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="form-label">Date *</label>
                        <input type="date" className="block w-full px-3 text-sm text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0" value={form.date} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} />
                    </div>
                </div>
                <div>
                    <label className="form-label">Warehouse (optional)</label>
                    <select className="block w-full px-3 text-sm text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0" value={form.warehouseId} onChange={(e) => setForm((p) => ({ ...p, warehouseId: e.target.value }))}>
                        <option value="">No specific warehouse</option>
                        {warehouses.map((wh) => <option key={wh.id} value={wh.id}>{wh.name}</option>)}
                    </select>
                </div>
                <div>
                    <label className="form-label">Notes</label>
                    <textarea className="block w-full px-3 py-2 text-sm text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md focus:border-primary-500 focus:outline-0 resize-none" rows={2} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
                </div>
                <div>
                    <label className="form-label">Status</label>
                    <div className="flex gap-4 text-sm">
                        {(['Draft', 'Delivered'] as const).map((s) => (
                            <label key={s} className="flex items-center gap-2 cursor-pointer"><input type="radio" name="dn-status" value={s} checked={form.status === s} onChange={() => setForm((p) => ({ ...p, status: s }))} />{s}</label>
                        ))}
                    </div>
                </div>
                {form.lines.length > 0 && (
                    <div>
                        <label className="form-label">Line Items</label>
                        <div className="border border-neutral-200 rounded-lg overflow-hidden">
                            <table className="w-full text-sm">
                                <thead className="bg-neutral-50"><tr>
                                    <th className="p-2 text-left text-xs font-semibold text-neutral-600">Item</th>
                                    <th className="p-2 text-right text-xs font-semibold text-neutral-600 w-[100px]">Ordered</th>
                                    <th className="p-2 text-right text-xs font-semibold text-neutral-600 w-[110px]">Deliver</th>
                                </tr></thead>
                                <tbody>
                                    {form.lines.map((line, idx) => (
                                        <tr key={idx} className="border-t border-neutral-100">
                                            <td className="p-2 text-neutral-800">{line.description || line.itemId}</td>
                                            <td className="p-2 text-right text-neutral-600">{line.qtyOrdered} {line.unit}</td>
                                            <td className="p-2"><input type="number" min={0} max={line.qtyOrdered} className="w-full px-2 text-right border border-neutral-300 rounded h-8 text-sm focus:border-primary-500 focus:outline-0" value={line.qtyToDeliver} onChange={(e) => handleLineQtyChange(idx, Number(e.target.value))} /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
                <div className="flex justify-end gap-2 pt-2">
                    <Button text="Cancel" variant="secondary" onClick={close} />
                    <Button text={createDN.isPending ? 'Saving...' : 'Create Delivery Note'} variant="primary" onClick={handleSubmit} disabled={createDN.isPending} />
                </div>
            </div>
        </FormPage>
    );
};

export default DeliveryNoteForm;
