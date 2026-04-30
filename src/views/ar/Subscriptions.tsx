import React, { useState, useMemo } from 'react';
import { Plus, XCircle, RefreshCw, Edit2, Trash2 } from 'lucide-react';
import Card from '../../components/UI/Card';
import Button from '../../components/UI/Button';
import Table, { TableColumn } from '../../components/UI/Table';
import Modal from '../../components/UI/Modal';
import Input from '../../components/UI/Input';
import StatusTag from '../../components/UI/StatusTag';
import { formatIDR, formatDateID } from '../../utils/formatters';
import { useCustomers } from '../../hooks/useAR';
import {
  useSubscriptionPlans,
  useCreatePlan,
  useUpdatePlan,
  useDeletePlan,
  useSubscriptions,
  useCreateSubscription,
  useCancelSubscription,
  useGenerateSubscriptionInvoices,
  type SubscriptionPlan,
  type Subscription,
} from '../../hooks/useSubscriptions';

// ── Plan Form ────────────────────────────────────────────────────────────────

interface PlanFormState {
  name: string;
  price: string;
  interval: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  trialDays: string;
  isActive: boolean;
}

const EMPTY_PLAN: PlanFormState = {
  name: '',
  price: '0',
  interval: 'MONTHLY',
  trialDays: '0',
  isActive: true,
};

// ── Subscription Form ────────────────────────────────────────────────────────

interface SubFormState {
  customerId: string;
  planId: string;
  startDate: string;
}

const SubscriptionsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'subscriptions' | 'plans'>('subscriptions');

  // ── Plans ──────────────────────────────────────────────────────────────────
  const { data: plansData, isLoading: plansLoading } = useSubscriptionPlans();
  const createPlan = useCreatePlan();
  const updatePlan = useUpdatePlan();
  const deletePlan = useDeletePlan();
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [planForm, setPlanForm] = useState<PlanFormState>(EMPTY_PLAN);

  const plans = useMemo(() => plansData?.data ?? [], [plansData]);

  // ── Subscriptions ──────────────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState('');
  const { data: subsData, isLoading: subsLoading } = useSubscriptions(statusFilter ? { status: statusFilter } : {});
  const createSub = useCreateSubscription();
  const cancelSub = useCancelSubscription();
  const generateInvoices = useGenerateSubscriptionInvoices();
  const [subModalOpen, setSubModalOpen] = useState(false);
  const [subForm, setSubForm] = useState<SubFormState>({
    customerId: '',
    planId: '',
    startDate: new Date().toISOString().slice(0, 10),
  });
  const [cancelResult, setCancelResult] = useState<{ refundAmount: number; daysRemaining: number; daysTotal: number } | null>(null);

  const subscriptions = useMemo(() => subsData?.data ?? [], [subsData]);

  const { data: customersData } = useCustomers({ limit: 200 });
  const customers = useMemo(() => customersData?.data ?? [], [customersData]);

  // ── Plan handlers ──────────────────────────────────────────────────────────

  const openCreatePlan = () => {
    setEditingPlanId(null);
    setPlanForm(EMPTY_PLAN);
    setPlanModalOpen(true);
  };

  const openEditPlan = (plan: SubscriptionPlan) => {
    setEditingPlanId(plan.id);
    setPlanForm({
      name: plan.name,
      price: String(plan.price),
      interval: plan.interval,
      trialDays: String(plan.trialDays),
      isActive: plan.isActive,
    });
    setPlanModalOpen(true);
  };

  const handleSavePlan = async () => {
    if (!planForm.name || !planForm.price) {
      window.alert('Name and price are required.');
      return;
    }
    const data = {
      name: planForm.name,
      price: Number(planForm.price),
      interval: planForm.interval,
      trialDays: Number(planForm.trialDays) || 0,
      isActive: planForm.isActive,
    };
    if (editingPlanId) {
      await updatePlan.mutateAsync({ id: editingPlanId, ...data });
    } else {
      await createPlan.mutateAsync(data);
    }
    setPlanModalOpen(false);
  };

  const handleDeletePlan = async (id: string) => {
    if (!window.confirm('Delete this plan?')) return;
    try {
      await deletePlan.mutateAsync(id);
    } catch (e: any) {
      window.alert(e.message || 'Cannot delete plan');
    }
  };

  // ── Subscription handlers ──────────────────────────────────────────────────

  const handleCreateSub = async () => {
    if (!subForm.customerId || !subForm.planId) {
      window.alert('Customer and plan are required.');
      return;
    }
    await createSub.mutateAsync(subForm);
    setSubModalOpen(false);
  };

  const handleCancel = async (id: string) => {
    if (!window.confirm('Cancel this subscription? A pro-rata refund will be calculated.')) return;
    try {
      const result = await cancelSub.mutateAsync(id);
      setCancelResult(result as any);
    } catch (e: any) {
      window.alert(e.message || 'Failed to cancel');
    }
  };

  const handleGenerateInvoices = async () => {
    try {
      const result = await generateInvoices.mutateAsync();
      window.alert(`Generated ${(result as any).generated} invoice(s).`);
    } catch (e: any) {
      window.alert(e.message || 'Failed to generate invoices');
    }
  };

  // ── Columns ────────────────────────────────────────────────────────────────

  const planColumns: TableColumn<SubscriptionPlan>[] = [
    { key: 'name', label: 'Plan Name' },
    { key: 'price', label: 'Price', render: (val) => formatIDR(Number(val)) },
    { key: 'interval', label: 'Interval', render: (val) => <StatusTag status={val as string} /> },
    { key: 'trialDays', label: 'Trial Days' },
    {
      key: 'isActive',
      label: 'Status',
      render: (val) => <StatusTag status={val ? 'Active' : 'Inactive'} />,
    },
    {
      key: 'id',
      label: 'Actions',
      render: (_val, row) => (
        <div className="flex items-center gap-1">
          <button onClick={() => openEditPlan(row as SubscriptionPlan)} className="p-1.5 text-neutral-500 hover:text-primary-600 rounded" title="Edit">
            <Edit2 size={16} />
          </button>
          <button onClick={() => handleDeletePlan((row as any).id)} className="p-1.5 text-neutral-500 hover:text-danger-600 rounded" title="Delete">
            <Trash2 size={16} />
          </button>
        </div>
      ),
    },
  ];

  const subColumns: TableColumn<Subscription>[] = [
    {
      key: 'customer',
      label: 'Customer',
      render: (_val, row) => (row as Subscription).customer?.name || '',
    },
    {
      key: 'plan',
      label: 'Plan',
      render: (_val, row) => (row as Subscription).plan?.name || '',
    },
    { key: 'status', label: 'Status', render: (val) => <StatusTag status={val as string} /> },
    {
      key: 'currentPeriodStart',
      label: 'Period',
      render: (_val, row) => {
        const sub = row as Subscription;
        return `${formatDateID(sub.currentPeriodStart)} - ${formatDateID(sub.currentPeriodEnd)}`;
      },
    },
    {
      key: 'nextInvoiceDate',
      label: 'Next Invoice',
      render: (val) => val ? formatDateID(val as string) : '-',
    },
    {
      key: 'id',
      label: 'Actions',
      render: (_val, row) => {
        const sub = row as Subscription;
        if (sub.status === 'CANCELLED') return <span className="text-xs text-neutral-400">Cancelled</span>;
        return (
          <button
            onClick={() => handleCancel(sub.id)}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-danger-600 bg-danger-50 rounded hover:bg-danger-100 transition"
          >
            <XCircle size={14} /> Cancel
          </button>
        );
      },
    },
  ];

  return (
    <div className="container max-w-[1200px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-neutral-900">Subscriptions</h1>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-4 border-b border-neutral-200">
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
            activeTab === 'subscriptions' ? 'border-primary-500 text-primary-600' : 'border-transparent text-neutral-500 hover:text-neutral-700'
          }`}
          onClick={() => setActiveTab('subscriptions')}
        >
          Subscriptions
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
            activeTab === 'plans' ? 'border-primary-500 text-primary-600' : 'border-transparent text-neutral-500 hover:text-neutral-700'
          }`}
          onClick={() => setActiveTab('plans')}
        >
          Plans
        </button>
      </div>

      {activeTab === 'subscriptions' && (
        <>
          <div className="flex items-center justify-between mb-4">
            <select
              className="h-9 px-3 text-sm border border-neutral-300 rounded-md bg-neutral-0 focus:border-primary-500 focus:outline-0"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All Statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="TRIALING">Trialing</option>
              <option value="PAST_DUE">Past Due</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
            <div className="flex items-center gap-2">
              <Button
                text="Generate Invoices"
                variant="secondary"
                size="small"
                icon={<RefreshCw size={14} />}
                onClick={handleGenerateInvoices}
                disabled={generateInvoices.isPending}
              />
              <Button
                text="New Subscription"
                variant="primary"
                size="small"
                icon={<Plus size={14} />}
                onClick={() => setSubModalOpen(true)}
              />
            </div>
          </div>

          <Card padding={false}>
            {subsLoading ? (
              <div className="p-8 text-center text-neutral-500">Loading subscriptions...</div>
            ) : subscriptions.length === 0 ? (
              <div className="p-8 text-center text-neutral-500">No subscriptions found.</div>
            ) : (
              <Table columns={subColumns} data={subscriptions} />
            )}
          </Card>
        </>
      )}

      {activeTab === 'plans' && (
        <>
          <div className="flex items-center justify-end mb-4">
            <Button text="New Plan" variant="primary" size="small" icon={<Plus size={14} />} onClick={openCreatePlan} />
          </div>

          <Card padding={false}>
            {plansLoading ? (
              <div className="p-8 text-center text-neutral-500">Loading plans...</div>
            ) : plans.length === 0 ? (
              <div className="p-8 text-center text-neutral-500">No subscription plans found.</div>
            ) : (
              <Table columns={planColumns} data={plans} />
            )}
          </Card>
        </>
      )}

      {/* Create Subscription Modal */}
      {subModalOpen && (
        <Modal isOpen title="New Subscription" onClose={() => setSubModalOpen(false)}>
          <div className="space-y-4 p-4">
            <div>
              <label className="form-label">Customer</label>
              <select
                className="block w-full h-10 px-3 text-sm border border-neutral-300 rounded-md bg-neutral-0 focus:border-primary-500 focus:outline-0"
                value={subForm.customerId}
                onChange={(e) => setSubForm((p) => ({ ...p, customerId: e.target.value }))}
              >
                <option value="">Select customer...</option>
                {customers.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">Plan</label>
              <select
                className="block w-full h-10 px-3 text-sm border border-neutral-300 rounded-md bg-neutral-0 focus:border-primary-500 focus:outline-0"
                value={subForm.planId}
                onChange={(e) => setSubForm((p) => ({ ...p, planId: e.target.value }))}
              >
                <option value="">Select plan...</option>
                {plans.filter((p: any) => p.isActive).map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {p.name} - {formatIDR(Number(p.price))}/{p.interval}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">Start Date</label>
              <Input
                type="date"
                value={subForm.startDate}
                onChange={(e) => setSubForm((p) => ({ ...p, startDate: e.target.value }))}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button text="Cancel" variant="secondary" onClick={() => setSubModalOpen(false)} />
              <Button text="Create" variant="primary" onClick={handleCreateSub} disabled={createSub.isPending} />
            </div>
          </div>
        </Modal>
      )}

      {/* Plan Modal */}
      {planModalOpen && (
        <Modal isOpen title={editingPlanId ? 'Edit Plan' : 'New Plan'} onClose={() => setPlanModalOpen(false)}>
          <div className="space-y-4 p-4">
            <div>
              <label className="form-label">Plan Name</label>
              <Input value={planForm.name} onChange={(e) => setPlanForm((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="form-label">Price</label>
                <Input type="number" value={planForm.price} onChange={(e) => setPlanForm((p) => ({ ...p, price: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Interval</label>
                <select
                  className="block w-full h-10 px-3 text-sm border border-neutral-300 rounded-md bg-neutral-0 focus:border-primary-500 focus:outline-0"
                  value={planForm.interval}
                  onChange={(e) => setPlanForm((p) => ({ ...p, interval: e.target.value as any }))}
                >
                  <option value="MONTHLY">Monthly</option>
                  <option value="QUARTERLY">Quarterly</option>
                  <option value="YEARLY">Yearly</option>
                </select>
              </div>
            </div>
            <div>
              <label className="form-label">Trial Days</label>
              <Input type="number" value={planForm.trialDays} onChange={(e) => setPlanForm((p) => ({ ...p, trialDays: e.target.value }))} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={planForm.isActive}
                onChange={(e) => setPlanForm((p) => ({ ...p, isActive: e.target.checked }))}
                className="w-4 h-4 text-primary-600 rounded"
              />
              Active
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Button text="Cancel" variant="secondary" onClick={() => setPlanModalOpen(false)} />
              <Button text={editingPlanId ? 'Save' : 'Create'} variant="primary" onClick={handleSavePlan} disabled={createPlan.isPending || updatePlan.isPending} />
            </div>
          </div>
        </Modal>
      )}

      {/* Cancel Result Modal */}
      {cancelResult && (
        <Modal isOpen title="Subscription Cancelled" onClose={() => setCancelResult(null)} size="sm">
          <div className="p-4 space-y-3">
            <div className="text-sm text-neutral-700">
              <p>The subscription has been cancelled. Here is the pro-rata refund calculation:</p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="text-neutral-500">Days Remaining</div>
              <div className="font-medium">{cancelResult.daysRemaining} / {cancelResult.daysTotal} days</div>
              <div className="text-neutral-500">Refund Amount</div>
              <div className="font-medium text-primary-600">{formatIDR(cancelResult.refundAmount)}</div>
            </div>
            <div className="flex justify-end pt-2">
              <Button text="Close" variant="secondary" onClick={() => setCancelResult(null)} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default SubscriptionsPage;
