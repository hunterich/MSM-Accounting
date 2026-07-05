import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, Pause, Play, Edit2, StopCircle, Trash2, Download } from 'lucide-react';
import { exportToCsv } from '../../utils/exportCsv';
import { api } from '../../api/apiClient';
import Button from '../../components/UI/Button';
import Card from '../../components/UI/Card';
import Modal from '../../components/UI/Modal';
import Input from '../../components/UI/Input';
import Table, { TableColumn } from '../../components/UI/Table';
import StatusTag from '../../components/UI/StatusTag';
import { formatDateID } from '../../utils/formatters';
import PageHeader from '../../components/Layout/PageHeader';
import { useToastStore } from '../../stores/useToastStore';

// ── Types ─────────────────────────────────────────────────────────────────────

type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';
type RecurringStatus = 'ACTIVE' | 'PAUSED' | 'ENDED';

interface RecurringLine {
    lineNo: number;
    description: string;
    quantity: number;
    price: number;
    unit?: string;
    discountPct: number;
    taxable: boolean;
}

interface RecurringExpense {
    id: string;
    title: string;
    frequency: Frequency;
    status: RecurringStatus;
    nextRunDate: string;
    startDate: string;
    endDate?: string;
    autoPost: boolean;
    vendor: { id: string; name: string; code: string };
    lines: RecurringLine[];
}

interface VendorOption {
    id: string;
    name: string;
    code: string;
}

interface FormLine {
    description: string;
    quantity: number;
    unit: string;
    price: number;
    discountPct: number;
}

interface FormState {
    title: string;
    vendorId: string;
    frequency: Frequency;
    startDate: string;
    endDate: string;
    autoPost: boolean;
    notes: string;
    lines: FormLine[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const FREQUENCY_OPTIONS: { value: Frequency; label: string }[] = [
    { value: 'DAILY',     label: 'Daily'     },
    { value: 'WEEKLY',    label: 'Weekly'    },
    { value: 'MONTHLY',   label: 'Monthly'   },
    { value: 'QUARTERLY', label: 'Quarterly' },
    { value: 'ANNUAL',    label: 'Annual'    },
];

const BLANK_LINE: FormLine = { description: '', quantity: 1, unit: '', price: 0, discountPct: 0 };

const BLANK_FORM: FormState = {
    title: '',
    vendorId: '',
    frequency: 'MONTHLY',
    startDate: '',
    endDate: '',
    autoPost: false,
    notes: '',
    lines: [{ ...BLANK_LINE }],
};

// ── Status badge helper ───────────────────────────────────────────────────────

function statusTagProps(status: RecurringStatus): { status: string; label: string } {
    if (status === 'ACTIVE') return { status: 'active',  label: 'Active' };
    if (status === 'PAUSED') return { status: 'warning', label: 'Paused' };
    return { status: 'neutral', label: 'Ended' };
}

// ── Component ─────────────────────────────────────────────────────────────────

const RecurringExpenses: React.FC = () => {
    const queryClient = useQueryClient();

    const pushToast = useToastStore((s) => s.pushToast);

    const [modalOpen, setModalOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState<FormState>({ ...BLANK_FORM, lines: [{ ...BLANK_LINE }] });

    // ── Queries ───────────────────────────────────────────────────────────────

    const { data: listData, isLoading } = useQuery<{ data: RecurringExpense[] }>({
        queryKey: ['recurringBills'],
        queryFn: () => api.get('/api/v1/recurring-bills'),
    });

    const { data: vendorsData } = useQuery<{ data: VendorOption[] }>({
        queryKey: ['vendors'],
        queryFn: () => api.get('/api/v1/vendors'),
        enabled: modalOpen,
    });

    const recurringExpenses = listData?.data ?? [];
    const vendors = vendorsData?.data ?? [];

    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['recurringBills'] });

    // ── Mutations ─────────────────────────────────────────────────────────────

    const createMutation = useMutation({
        mutationFn: (payload: unknown) => api.post('/api/v1/recurring-bills', payload),
        onSuccess: () => { invalidate(); closeModal(); pushToast('Recurring expense created.'); },
        onError: (err: Error) => pushToast(err.message, 'error'),
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, payload }: { id: string; payload: unknown }) =>
            api.put(`/api/v1/recurring-bills/${id}`, payload),
        onSuccess: () => { invalidate(); closeModal(); pushToast('Recurring expense updated.'); },
        onError: (err: Error) => pushToast(err.message, 'error'),
    });

    const generateMutation = useMutation({
        mutationFn: (id: string) =>
            api.post<{ billNumber?: string; number?: string }>(`/api/v1/recurring-bills/${id}/generate`),
        onSuccess: (data) => {
            invalidate();
            const num = (data as { billNumber?: string; number?: string }).billNumber
                ?? (data as { billNumber?: string; number?: string }).number
                ?? 'N/A';
            pushToast(`Bill ${num} created.`);
        },
        onError: (err: Error) => pushToast(err.message, 'error'),
    });

    const statusMutation = useMutation({
        mutationFn: ({ id, status }: { id: string; status: RecurringStatus }) =>
            api.put(`/api/v1/recurring-bills/${id}`, { status }),
        onSuccess: (_data, vars) => {
            invalidate();
            const label = vars.status === 'PAUSED' ? 'paused' : vars.status === 'ACTIVE' ? 'resumed' : 'ended';
            pushToast(`Recurring expense ${label}.`);
        },
        onError: (err: Error) => pushToast(err.message, 'error'),
    });

    // ── Modal helpers ─────────────────────────────────────────────────────────

    const openCreate = () => {
        setEditingId(null);
        setForm({ ...BLANK_FORM, lines: [{ ...BLANK_LINE }] });
        setModalOpen(true);
    };

    const openEdit = (rec: RecurringExpense) => {
        setEditingId(rec.id);
        setForm({
            title: rec.title,
            vendorId: rec.vendor.id,
            frequency: rec.frequency,
            startDate: rec.startDate?.slice(0, 10) ?? '',
            endDate: rec.endDate?.slice(0, 10) ?? '',
            autoPost: rec.autoPost,
            notes: '',
            lines: rec.lines.length > 0
                ? rec.lines.map((l) => ({
                    description: l.description,
                    quantity: l.quantity,
                    unit: l.unit ?? '',
                    price: l.price,
                    discountPct: l.discountPct,
                }))
                : [{ ...BLANK_LINE }],
        });
        setModalOpen(true);
    };

    const closeModal = () => {
        setModalOpen(false);
        setEditingId(null);
        setForm({ ...BLANK_FORM, lines: [{ ...BLANK_LINE }] });
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const payload = {
            title: form.title,
            vendorId: form.vendorId,
            frequency: form.frequency,
            startDate: form.startDate,
            endDate: form.endDate || undefined,
            autoPost: form.autoPost,
            notes: form.notes,
            lines: form.lines.map((l, i) => ({
                lineNo: i + 1,
                description: l.description,
                quantity: Number(l.quantity),
                unit: l.unit || undefined,
                price: Number(l.price),
                discountPct: Number(l.discountPct),
                taxable: false,
            })),
        };
        if (editingId) {
            updateMutation.mutate({ id: editingId, payload });
        } else {
            createMutation.mutate(payload);
        }
    };

    // ── Line helpers ──────────────────────────────────────────────────────────

    const updateLine = (index: number, field: keyof FormLine, value: string | number) => {
        setForm((prev) => {
            const lines = [...prev.lines];
            lines[index] = { ...lines[index], [field]: value };
            return { ...prev, lines };
        });
    };

    const addLine = () =>
        setForm((prev) => ({ ...prev, lines: [...prev.lines, { ...BLANK_LINE }] }));

    const removeLine = (index: number) =>
        setForm((prev) => ({
            ...prev,
            lines: prev.lines.length > 1 ? prev.lines.filter((_, i) => i !== index) : prev.lines,
        }));

    // ── Table columns ─────────────────────────────────────────────────────────

    const columns: TableColumn<Record<string, unknown>>[] = [
        {
            key: 'title',
            label: 'Title',
            sortable: true,
        },
        {
            key: 'vendor',
            label: 'Vendor',
            render: (_val, row) => {
                const vendor = row['vendor'] as RecurringExpense['vendor'] | undefined;
                return <span>{vendor?.name ?? '—'}</span>;
            },
        },
        {
            key: 'frequency',
            label: 'Frequency',
            render: (val) => {
                const label = FREQUENCY_OPTIONS.find((o) => o.value === val)?.label ?? (val as string);
                return <span className="text-neutral-700">{label}</span>;
            },
        },
        {
            key: 'nextRunDate',
            label: 'Next Run',
            render: (val) => formatDateID(val as string) || '—',
        },
        {
            key: 'status',
            label: 'Status',
            render: (val) => {
                const props = statusTagProps(val as RecurringStatus);
                return <StatusTag status={props.status} label={props.label} />;
            },
        },
        {
            key: 'actions',
            label: '',
            render: (_val, row) => {
                const rec = row as unknown as RecurringExpense;
                return (
                    <div className="flex items-center gap-1 justify-end">
                        {rec.status === 'ACTIVE' && (
                            <Button
                                size="small"
                                variant="secondary"
                                icon={<RefreshCw size={13} />}
                                text="Generate"
                                onClick={(e) => { e.stopPropagation(); generateMutation.mutate(rec.id); }}
                                disabled={generateMutation.isPending}
                            />
                        )}
                        {rec.status === 'ACTIVE' && (
                            <Button
                                size="small"
                                variant="secondary"
                                icon={<Pause size={13} />}
                                text="Pause"
                                onClick={(e) => { e.stopPropagation(); statusMutation.mutate({ id: rec.id, status: 'PAUSED' }); }}
                                disabled={statusMutation.isPending}
                            />
                        )}
                        {rec.status === 'PAUSED' && (
                            <Button
                                size="small"
                                variant="secondary"
                                icon={<Play size={13} />}
                                text="Resume"
                                onClick={(e) => { e.stopPropagation(); statusMutation.mutate({ id: rec.id, status: 'ACTIVE' }); }}
                                disabled={statusMutation.isPending}
                            />
                        )}
                        {rec.status !== 'ENDED' && (
                            <Button
                                size="small"
                                variant="tertiary"
                                icon={<Edit2 size={13} />}
                                text="Edit"
                                onClick={(e) => { e.stopPropagation(); openEdit(rec); }}
                            />
                        )}
                        {rec.status !== 'ENDED' && (
                            <Button
                                size="small"
                                variant="danger"
                                icon={<StopCircle size={13} />}
                                text="End"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    statusMutation.mutate({ id: rec.id, status: 'ENDED' });
                                }}
                                disabled={statusMutation.isPending}
                            />
                        )}
                    </div>
                );
            },
        },
    ];

    const isSaving = createMutation.isPending || updateMutation.isPending;

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div className="container ap-module container-full-width">
            <PageHeader
                title="Recurring Expenses"
                subtitle="Subscriptions and other vendor bills that repeat on a schedule — ChatGPT, Microsoft 365, hosting, rent."
            />

            {/* Toolbar */}
            <div className="flex items-center justify-end gap-2 mb-4">
                <Button
                    text="Export CSV"
                    size="small"
                    variant="secondary"
                    icon={<Download size={16} />}
                    onClick={() => {
                        const rows = recurringExpenses.map((ri) => ({
                            title: ri.title,
                            frequency: FREQUENCY_OPTIONS.find((o) => o.value === ri.frequency)?.label ?? ri.frequency,
                            status: ri.status,
                            nextRunDate: ri.nextRunDate,
                        }));
                        exportToCsv('recurring-expenses.csv', rows, [
                            { label: 'Title', key: 'title' },
                            { label: 'Frequency', key: 'frequency' },
                            { label: 'Status', key: 'status' },
                            { label: 'Next Run Date', key: 'nextRunDate' },
                        ]);
                    }}
                />
                <Button
                    text="New Recurring Expense"
                    size="small"
                    icon={<Plus size={16} />}
                    onClick={openCreate}
                />
            </div>

            {/* List table */}
            <Card padding={false}>
                <Table
                    columns={columns}
                    data={recurringExpenses as unknown as Record<string, unknown>[]}
                    isLoading={isLoading}
                    loadingLabel="Loading recurring expenses..."
                    showCount
                    countLabel="recurring expenses"
                    virtualize={false}
                />
            </Card>

            {/* Create / Edit modal */}
            {modalOpen && (
                <Modal
                    isOpen
                    size="lg"
                    onClose={closeModal}
                    title={editingId ? 'Edit Recurring Expense' : 'New Recurring Expense'}
                >
                    <form onSubmit={handleSubmit} className="space-y-5">
                        {/* Title */}
                        <div>
                            <label className="form-label">
                                Title <span className="text-danger-500">*</span>
                            </label>
                            <Input
                                required
                                value={form.title}
                                onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                                placeholder="e.g. Monthly Retainer – Acme Corp"
                            />
                        </div>

                        {/* Vendor + Frequency */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="form-label">
                                    Vendor <span className="text-danger-500">*</span>
                                </label>
                                <select
                                    required
                                    className="block w-full h-10 px-3 text-sm border border-neutral-300 rounded-md bg-neutral-0 focus:border-primary-500 focus:outline-0"
                                    value={form.vendorId}
                                    onChange={(e) => setForm((p) => ({ ...p, vendorId: e.target.value }))}
                                >
                                    <option value="">Select vendor…</option>
                                    {vendors.map((c) => (
                                        <option key={c.id} value={c.id}>{c.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="form-label">
                                    Frequency <span className="text-danger-500">*</span>
                                </label>
                                <select
                                    className="block w-full h-10 px-3 text-sm border border-neutral-300 rounded-md bg-neutral-0 focus:border-primary-500 focus:outline-0"
                                    value={form.frequency}
                                    onChange={(e) =>
                                        setForm((p) => ({ ...p, frequency: e.target.value as Frequency }))
                                    }
                                >
                                    {FREQUENCY_OPTIONS.map((o) => (
                                        <option key={o.value} value={o.value}>{o.label}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* Start date + End date */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="form-label">
                                    Start Date <span className="text-danger-500">*</span>
                                </label>
                                <Input
                                    required
                                    type="date"
                                    value={form.startDate}
                                    onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))}
                                />
                            </div>
                            <div>
                                <label className="form-label">
                                    End Date{' '}
                                    <span className="text-neutral-400 font-normal">(optional)</span>
                                </label>
                                <Input
                                    type="date"
                                    value={form.endDate}
                                    onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))}
                                />
                            </div>
                        </div>

                        {/* Auto Post */}
                        <label className="flex items-center gap-2 text-sm font-medium text-neutral-700 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                className="w-4 h-4 rounded border-neutral-300 text-primary-700 focus:ring-primary-500 cursor-pointer"
                                checked={form.autoPost}
                                onChange={(e) => setForm((p) => ({ ...p, autoPost: e.target.checked }))}
                            />
                            Auto-post generated bills (mark payable immediately)
                        </label>

                        {/* Notes */}
                        <div>
                            <label className="form-label">Notes</label>
                            <textarea
                                rows={2}
                                className="block w-full px-3 py-2 text-sm border border-neutral-300 rounded-md bg-neutral-0 focus:border-primary-500 focus:outline-0 resize-none"
                                value={form.notes}
                                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                                placeholder="Internal notes…"
                            />
                        </div>

                        {/* Lines table */}
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <label className="form-label mb-0">Expense Lines</label>
                                <button
                                    type="button"
                                    onClick={addLine}
                                    className="inline-flex items-center gap-1 text-xs text-primary-700 hover:text-primary-900 font-medium transition-colors"
                                >
                                    <Plus size={12} /> Add line
                                </button>
                            </div>
                            <div className="rounded-lg border border-neutral-200 overflow-hidden">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-neutral-100 text-neutral-600 text-left">
                                            <th className="px-3 py-2 font-medium">Description</th>
                                            <th className="px-3 py-2 font-medium w-20 text-right">Qty</th>
                                            <th className="px-3 py-2 font-medium w-20">Unit</th>
                                            <th className="px-3 py-2 font-medium w-28 text-right">Price</th>
                                            <th className="px-3 py-2 font-medium w-20 text-right">Disc%</th>
                                            <th className="px-2 py-2 w-8"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {form.lines.map((line, i) => (
                                            <tr key={i} className="border-t border-neutral-200">
                                                <td className="px-2 py-1.5">
                                                    <input
                                                        type="text"
                                                        className="w-full h-8 px-2 rounded border border-neutral-200 text-sm focus:border-primary-500 focus:outline-0"
                                                        value={line.description}
                                                        onChange={(e) =>
                                                            updateLine(i, 'description', e.target.value)
                                                        }
                                                        placeholder="Description"
                                                    />
                                                </td>
                                                <td className="px-2 py-1.5">
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        step="any"
                                                        className="w-full h-8 px-2 rounded border border-neutral-200 text-sm text-right focus:border-primary-500 focus:outline-0"
                                                        value={line.quantity}
                                                        onChange={(e) =>
                                                            updateLine(i, 'quantity', e.target.value)
                                                        }
                                                    />
                                                </td>
                                                <td className="px-2 py-1.5">
                                                    <input
                                                        type="text"
                                                        className="w-full h-8 px-2 rounded border border-neutral-200 text-sm focus:border-primary-500 focus:outline-0"
                                                        value={line.unit}
                                                        onChange={(e) =>
                                                            updateLine(i, 'unit', e.target.value)
                                                        }
                                                        placeholder="pcs"
                                                    />
                                                </td>
                                                <td className="px-2 py-1.5">
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        step="any"
                                                        className="w-full h-8 px-2 rounded border border-neutral-200 text-sm text-right focus:border-primary-500 focus:outline-0"
                                                        value={line.price}
                                                        onChange={(e) =>
                                                            updateLine(i, 'price', e.target.value)
                                                        }
                                                    />
                                                </td>
                                                <td className="px-2 py-1.5">
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        max="100"
                                                        step="any"
                                                        className="w-full h-8 px-2 rounded border border-neutral-200 text-sm text-right focus:border-primary-500 focus:outline-0"
                                                        value={line.discountPct}
                                                        onChange={(e) =>
                                                            updateLine(i, 'discountPct', e.target.value)
                                                        }
                                                    />
                                                </td>
                                                <td className="px-2 py-1.5 text-center">
                                                    <button
                                                        type="button"
                                                        onClick={() => removeLine(i)}
                                                        disabled={form.lines.length === 1}
                                                        className="text-neutral-400 hover:text-danger-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                                        title="Remove line"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="flex items-center justify-end gap-2 pt-2">
                            <Button
                                type="button"
                                text="Cancel"
                                variant="secondary"
                                onClick={closeModal}
                                disabled={isSaving}
                            />
                            <Button
                                type="submit"
                                text={isSaving ? 'Saving…' : editingId ? 'Save Changes' : 'Create'}
                                disabled={isSaving}
                            />
                        </div>
                    </form>
                </Modal>
            )}
        </div>
    );
};

export default RecurringExpenses;
