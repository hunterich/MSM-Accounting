// src/components/ar/customers/CustomerDetailPane.tsx
//
// Workspace-native customer detail (one tab per customer). Renders the same
// detail layout the pre-workspace Customers view used; the Edit
// action opens a doc-form tab.
import React, { useMemo, useState } from 'react';
import { User, MapPin, Clock3, History } from 'lucide-react';
import Button from '../../UI/Button';
import StatusTag from '../../UI/StatusTag';
import { formatIDR } from '../../../utils/formatters';
import { useCustomers } from '../../../hooks/useAR';
import { useWorkspaceNav } from '../../../hooks/useWorkspaceNav';
import { useModulePermissions } from '../../../hooks/useModulePermissions';
import { useSettingsStore } from '../../../stores/useSettingsStore';

interface Props { customerId: string; workspaceTabId: string }

const CustomerDetailPane = ({ customerId }: Props): React.ReactElement => {
    const { canEdit } = useModulePermissions('ar_customers');
    const { open } = useWorkspaceNav();
    const masterCreditSettings = useSettingsStore((s) => s.customerCreditSettings);
    const { data: cuResult } = useCustomers();
    const customer = useMemo(
        () => (cuResult?.data ?? []).find((c) => c.id === customerId) ?? null,
        [cuResult?.data, customerId],
    );
    const [detailTab, setDetailTab] = useState<string>('summary');

    if (!customer) return <div className="p-6 text-sm text-neutral-500">Customer not found.</div>;

    const openEdit = () => open({
        kind: 'doc-form',
        target: { module: 'ar', entity: 'customer', recordId: customer.id, mode: 'edit' },
        title: `Edit ${customer.name}`,
        path: `/ar/customers/edit?id=${customer.id}&mode=edit`,
    });

    return (
        <div className="container ar-module container-full-width">
            <div className="bg-neutral-0 border border-neutral-200 rounded-lg overflow-hidden">
                <div className="flex items-center justify-between py-2.5 px-3 border-b border-[#d7dbe0]">
                    <div className="flex items-center gap-2.5">
                        <h2 className="m-0 text-xl font-semibold">{customer.name}</h2>
                        <StatusTag status={customer.status} />
                    </div>
                    <div className="flex gap-2">
                        <Button text="Edit" size="small" variant="primary" disabled={!canEdit} onClick={openEdit} />
                    </div>
                </div>
                <div className="grid grid-cols-4 gap-2 py-2.5 px-3 border-b border-[#d7dbe0]">
                    <div className="border border-[#d7dbe0] rounded-md py-1.5 px-2 min-h-14">
                        <label className="block text-neutral-600 text-[0.74rem] mb-0.5">Email</label>
                        <div className="text-base font-semibold">{customer.email || '-'}</div>
                    </div>
                    <div className="border border-[#d7dbe0] rounded-md py-1.5 px-2 min-h-14">
                        <label className="block text-neutral-600 text-[0.74rem] mb-0.5">Category</label>
                        <div className="text-base font-semibold">{customer.category || '-'}</div>
                    </div>
                    <div className="border border-[#d7dbe0] rounded-md py-1.5 px-2 min-h-14">
                        <label className="block text-neutral-600 text-[0.74rem] mb-0.5">Payment Terms</label>
                        <div className="text-base font-semibold">{customer.paymentTerms === 0 ? 'Due on Receipt' : `Net ${customer.paymentTerms}`}</div>
                    </div>
                    <div className="border border-[#d7dbe0] rounded-md py-1.5 px-2 min-h-14">
                        <label className="block text-neutral-600 text-[0.74rem] mb-0.5">Default Discount</label>
                        <div className="text-base font-semibold">{customer.defaultDiscount || 0}%</div>
                    </div>
                    <div className="col-span-4 text-right text-[1.4rem] font-bold text-primary-700 pr-0.5">{formatIDR(customer.balance || 0)}</div>
                </div>

                <div className="grid grid-cols-[1fr_56px] items-stretch">
                    <div className="min-w-0">
                        <div className="flex gap-1 border-b border-neutral-200 px-2 pt-2">
                            {(['summary', 'terms', 'address', 'activity'] as const).map((t) => (
                                <button key={t} className={`border border-transparent border-b-2 border-b-transparent bg-transparent text-neutral-600 py-2 px-2.5 cursor-pointer font-semibold text-[0.85rem] capitalize ${detailTab === t ? '!text-primary-700 !border-b-primary-600' : ''}`} onClick={() => setDetailTab(t)}>{t}</button>
                            ))}
                        </div>
                        <div className="p-2.5">
                            {detailTab === 'summary' && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <div className="border border-neutral-200 rounded-lg p-2.5"><label className="block text-[0.78rem] text-neutral-600 mb-1">Name</label><strong>{customer.name}</strong></div>
                                    <div className="border border-neutral-200 rounded-lg p-2.5"><label className="block text-[0.78rem] text-neutral-600 mb-1">Status</label><StatusTag status={customer.status} /></div>
                                    <div className="border border-neutral-200 rounded-lg p-2.5"><label className="block text-[0.78rem] text-neutral-600 mb-1">Email</label><div>{customer.email || '-'}</div></div>
                                    <div className="border border-neutral-200 rounded-lg p-2.5"><label className="block text-[0.78rem] text-neutral-600 mb-1">Open Balance</label><strong>{formatIDR(customer.balance || 0)}</strong></div>
                                </div>
                            )}
                            {detailTab === 'terms' && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <div className="border border-neutral-200 rounded-lg p-2.5"><label className="block text-[0.78rem] text-neutral-600 mb-1">Payment Terms</label><strong>{customer.paymentTerms === 0 ? 'Due on Receipt' : `Net ${customer.paymentTerms}`}</strong></div>
                                    <div className="border border-neutral-200 rounded-lg p-2.5"><label className="block text-[0.78rem] text-neutral-600 mb-1">Default Discount</label><strong>{customer.defaultDiscount || 0}%</strong></div>
                                    <div className="border border-neutral-200 rounded-lg p-2.5"><label className="block text-[0.78rem] text-neutral-600 mb-1">Credit Limit</label><strong>{formatIDR(customer.creditLimit || 0)}</strong></div>
                                    <div className="border border-neutral-200 rounded-lg p-2.5"><label className="block text-[0.78rem] text-neutral-600 mb-1">Master Payment Terms</label><strong>{masterCreditSettings.defaultPaymentTerms === 0 ? 'Due on Receipt' : `Net ${masterCreditSettings.defaultPaymentTerms}`}</strong></div>
                                    <div className="border border-neutral-200 rounded-lg p-2.5 col-span-2"><label className="block text-[0.78rem] text-neutral-600 mb-1">Master Credit Limit</label><strong>{formatIDR(masterCreditSettings.defaultLimit || 0)}</strong></div>
                                </div>
                            )}
                            {detailTab === 'address' && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <div className="border border-neutral-200 rounded-lg p-2.5 col-span-2"><label className="block text-[0.78rem] text-neutral-600 mb-1">Billing Address</label><div>{customer.billingAddress || '-'}</div></div>
                                    <div className="border border-neutral-200 rounded-lg p-2.5 col-span-2"><label className="block text-[0.78rem] text-neutral-600 mb-1">Shipping Address</label><div>{customer.shippingAddress || '-'}</div></div>
                                </div>
                            )}
                            {detailTab === 'activity' && (
                                <ul className="list-none m-0 p-0">
                                    <li className="border border-neutral-200 rounded-lg py-2 px-2.5 mb-2 text-[0.88rem]"><div><strong>Customer created</strong></div><div>2026-02-01 • Admin</div></li>
                                    <li className="border border-neutral-200 rounded-lg py-2 px-2.5 mb-2 text-[0.88rem]"><div><strong>Last invoice generated</strong></div><div>2026-02-10 • System</div></li>
                                </ul>
                            )}
                        </div>
                    </div>
                    <div className="border-l border-[#d7dbe0] flex flex-col gap-2 items-center py-2.5 px-2 bg-[#fafbfc]">
                        <button className="w-[38px] h-[38px] rounded-lg border border-[#c6d4e3] bg-[#e9f3ff] text-[#1967b2] inline-flex items-center justify-center cursor-pointer" title="Summary" onClick={() => setDetailTab('summary')}><User size={18} /></button>
                        <button className="w-[38px] h-[38px] rounded-lg border border-[#c6d4e3] bg-[#e9f3ff] text-[#1967b2] inline-flex items-center justify-center cursor-pointer" title="Address" onClick={() => setDetailTab('address')}><MapPin size={18} /></button>
                        <button className="w-[38px] h-[38px] rounded-lg border border-[#8cd3a1] bg-[#d7f4df] text-[#1d7f3e] inline-flex items-center justify-center cursor-pointer" title="Terms" onClick={() => setDetailTab('terms')}><Clock3 size={18} /></button>
                        <button className="w-[38px] h-[38px] rounded-lg border border-[#f0b5b5] bg-[#ffe2e2] text-[#c43a3a] inline-flex items-center justify-center cursor-pointer" title="Activity" onClick={() => setDetailTab('activity')}><History size={18} /></button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CustomerDetailPane;
