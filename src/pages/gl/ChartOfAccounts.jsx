import React, { useMemo, useState } from 'react';
import Card from '../../components/UI/Card';
import Table from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import Modal from '../../components/UI/Modal';
import Input from '../../components/UI/Input';
import { Plus, Upload, ChevronDown, ChevronRight, PencilLine, Trash2, Archive, RotateCcw, Search, Loader } from 'lucide-react';
import ListPage from '../../components/Layout/ListPage';
import { useChartOfAccounts, useCreateAccount, useUpdateAccount, useDeleteAccount } from '../../hooks/useGL';
import {
    buildAccountTree,
    flattenTree,
    validateAccountCreate,
    validateAccountUpdate,
    canArchiveAccount,
    rollupBalances,
    getNormalSideByType,
    getDescendantAccountIds
} from '../../utils/coa';
import { formatIDR } from '../../utils/formatters';

const ACCOUNT_TYPES = ['Asset', 'Liability', 'Equity', 'Revenue', 'Expense'];

const EMPTY_FORM = {
    code: '',
    name: '',
    type: 'Asset',
    parentId: '',
    isPostable: true,
    isActive: true,
    reportGroup: '',
    reportSubGroup: ''
};

const normalizeLevels = (accounts) => {
    const tree = buildAccountTree(accounts);
    const normalized = [];

    const walk = (nodes, level) => {
        nodes.forEach((node) => {
            const { children, ...rest } = node;
            normalized.push({ ...rest, level });
            if (children.length > 0) {
                walk(children, level + 1);
            }
        });
    };

    walk(tree, 0);
    return normalized;
};

const DEPTH_PADDING = {
    0: 'pl-0',
    1: 'pl-4',
    2: 'pl-8',
    3: 'pl-12',
    4: 'pl-16',
    5: 'pl-20',
    6: 'pl-24',
};

const ChartOfAccounts = () => {
    const { data: accounts = [], isLoading } = useChartOfAccounts();
    const createAccount = useCreateAccount();
    const updateAccount = useUpdateAccount();
    const deleteAccount = useDeleteAccount();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingAccountId, setEditingAccountId] = useState(null);
    const [form, setForm] = useState(EMPTY_FORM);
    const [errors, setErrors] = useState({});
    const [collapsedAccountIds, setCollapsedAccountIds] = useState(new Set());
    const [search, setSearch] = useState('');
    const [typeFilter, setTypeFilter] = useState('All');
    const [activeFilter, setActiveFilter] = useState('All');
    const [postableFilter, setPostableFilter] = useState('All');
    const [reportGroupFilter, setReportGroupFilter] = useState('All');

    const accountById = useMemo(() => {
        return accounts.reduce((map, account) => {
            map[account.id] = account;
            return map;
        }, {});
    }, [accounts]);

    const accountTree = useMemo(() => buildAccountTree(accounts), [accounts]);
    const flatTree = useMemo(() => flattenTree(accountTree), [accountTree]);
    // Balances: real rollup requires a dedicated endpoint; use empty map until GL wiring is complete
    const groupedBalances = useMemo(() => rollupBalances(accounts, {}), [accounts]);

    const reportGroups = useMemo(() => {
        return Array.from(new Set(accounts.map((account) => account.reportGroup))).sort();
    }, [accounts]);

    const editingAccount = useMemo(() => {
        return accounts.find((account) => account.id === editingAccountId) || null;
    }, [accounts, editingAccountId]);

    const descendantOfEditing = useMemo(() => {
        if (!editingAccount) return new Set();
        return new Set(getDescendantAccountIds(editingAccount.id, accounts));
    }, [editingAccount, accounts]);

    const parentOptions = useMemo(() => {
        return accounts
            .filter((account) => {
                if (account.isPostable) return false;
                if (editingAccount && account.id === editingAccount.id) return false;
                if (editingAccount && descendantOfEditing.has(account.id)) return false;
                if (form.type && account.type !== form.type) return false;
                return true;
            })
            .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    }, [accounts, descendantOfEditing, editingAccount, form.type]);

    const isVisibleByCollapse = (account) => {
        let parentId = account.parentId;
        while (parentId) {
            if (collapsedAccountIds.has(parentId)) return false;
            parentId = accountById[parentId]?.parentId || null;
        }
        return true;
    };

    const filteredRows = useMemo(() => {
        const keyword = search.trim().toLowerCase();
        return flatTree.filter((account) => {
            if (!isVisibleByCollapse(account)) return false;

            if (typeFilter !== 'All' && account.type !== typeFilter) return false;

            if (activeFilter === 'Active' && !account.isActive) return false;
            if (activeFilter === 'Archived' && account.isActive) return false;

            if (postableFilter === 'Postable' && !account.isPostable) return false;
            if (postableFilter === 'Group' && account.isPostable) return false;

            if (reportGroupFilter !== 'All' && account.reportGroup !== reportGroupFilter) return false;

            if (!keyword) return true;
            const searchable = `${account.code} ${account.name} ${account.reportGroup} ${account.reportSubGroup || ''}`.toLowerCase();
            return searchable.includes(keyword);
        });
    }, [flatTree, search, typeFilter, activeFilter, postableFilter, reportGroupFilter, collapsedAccountIds, accountById]);

    const closeModal = () => {
        setIsModalOpen(false);
        setEditingAccountId(null);
        setForm(EMPTY_FORM);
        setErrors({});
    };

    const openCreate = () => {
        setEditingAccountId(null);
        setForm({
            ...EMPTY_FORM,
            reportGroup: reportGroupFilter !== 'All' ? reportGroupFilter : ''
        });
        setErrors({});
        setIsModalOpen(true);
    };

    const openEdit = (account) => {
        setEditingAccountId(account.id);
        setForm({
            code: account.code,
            name: account.name,
            type: account.type,
            parentId: account.parentId || '',
            isPostable: account.isPostable,
            isActive: account.isActive,
            reportGroup: account.reportGroup,
            reportSubGroup: account.reportSubGroup || ''
        });
        setErrors({});
        setIsModalOpen(true);
    };

    const toggleCollapse = (accountId) => {
        setCollapsedAccountIds((prev) => {
            const next = new Set(prev);
            if (next.has(accountId)) {
                next.delete(accountId);
            } else {
                next.add(accountId);
            }
            return next;
        });
    };

    const updateForm = (key, value) => {
        setForm((prev) => {
            const next = { ...prev, [key]: value };
            if (key === 'type') {
                const selectedParent = accountById[prev.parentId];
                if (selectedParent && selectedParent.type !== value) {
                    next.parentId = '';
                }
            }
            return next;
        });
        setErrors((prev) => ({ ...prev, [key]: null }));
    };

    const isSaving = createAccount.isPending || updateAccount.isPending;

    const handleSaveAccount = async () => {
        const normalSide = getNormalSideByType(form.type);
        const payload = {
            code:           form.code.trim(),
            name:           form.name.trim(),
            type:           form.type,
            parentId:       form.parentId || null,
            isPostable:     form.isPostable,
            isActive:       form.isActive,
            reportGroup:    form.reportGroup.trim(),
            reportSubGroup: form.reportSubGroup.trim(),
            normalSide,
        };

        if (editingAccount) {
            const nextAccount = { ...editingAccount, ...payload };
            const validation = validateAccountUpdate(editingAccount, nextAccount, accounts);
            if (!validation.isValid) { setErrors(validation.errors); return; }
            try {
                await updateAccount.mutateAsync({ id: editingAccount.id, ...payload });
                closeModal();
            } catch (err) {
                setErrors({ _api: err.message || 'Update failed.' });
            }
            return;
        }

        const validation = validateAccountCreate(payload, accounts);
        if (!validation.isValid) { setErrors(validation.errors); return; }
        try {
            await createAccount.mutateAsync(payload);
            closeModal();
        } catch (err) {
            setErrors({ _api: err.message || 'Create failed.' });
        }
    };

    const handleToggleArchive = async (account) => {
        try {
            await updateAccount.mutateAsync({ id: account.id, isActive: !account.isActive });
        } catch (err) {
            window.alert(err.message || 'Update failed.');
        }
    };

    const handleDelete = async (account) => {
        const deleteRules = canArchiveAccount(account, accounts);
        if (!deleteRules.canDelete) { window.alert(deleteRules.reason); return; }
        if (!window.confirm(`Delete account ${account.code} ${account.name}?`)) return;
        try {
            await deleteAccount.mutateAsync(account.id);
        } catch (err) {
            window.alert(err.message || 'Delete failed — account may have postings.');
        }
    };

    const columns = [
        { key: 'code', label: 'Code' },
        {
            key: 'name',
            label: 'Account Name',
            render: (_, account) => (
                <div className={`inline-flex items-center gap-1.5 ${DEPTH_PADDING[Math.min(account.depth, 6)] || 'pl-24'}`}>
                    {account.hasChildren ? (
                        <button
                            type="button"
                            className="w-5 h-5 border border-neutral-300 rounded-sm bg-neutral-0 text-neutral-700 inline-flex items-center justify-center cursor-pointer p-0 hover:border-primary-400 hover:text-primary-600"
                            onClick={() => toggleCollapse(account.id)}
                            aria-label={collapsedAccountIds.has(account.id) ? 'Expand' : 'Collapse'}
                        >
                            {collapsedAccountIds.has(account.id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                        </button>
                    ) : (
                        <span className="inline-block w-5" />
                    )}
                    <span className={`whitespace-nowrap ${account.isActive ? '' : 'text-neutral-600'}`}>{account.name}</span>
                    {account.hasPostings ? <span className="inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold leading-snug uppercase tracking-wide bg-neutral-100 text-neutral-700">Used</span> : null}
                </div>
            )
        },
        { key: 'type', label: 'Type' },
        {
            key: 'parentId',
            label: 'Parent',
            render: (parentId) => {
                if (!parentId) return '-';
                const parent = accountById[parentId];
                if (!parent) return 'Unknown';
                return `${parent.code} ${parent.name}`;
            }
        },
        { key: 'level', label: 'Level' },
        {
            key: 'reportGroup',
            label: 'Report Group',
            render: (_, account) => (
                <div className="flex flex-col gap-0.5">
                    <span>{account.reportGroup}</span>
                    {account.reportSubGroup ? <span className="text-neutral-600 text-xs">{account.reportSubGroup}</span> : null}
                </div>
            )
        },
        {
            key: 'isPostable',
            label: 'Postable',
            render: (value) => (
                <span className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold leading-snug uppercase tracking-wide ${value ? 'bg-primary-100 text-primary-700' : 'bg-neutral-100 text-neutral-700'}`}>
                    {value ? 'Postable' : 'Group'}
                </span>
            )
        },
        {
            key: 'isActive',
            label: 'Status',
            render: (value) => (
                <span className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold leading-snug uppercase tracking-wide ${value ? 'bg-success-100 text-success-700' : 'bg-neutral-100 text-neutral-600'}`}>
                    {value ? 'Active' : 'Archived'}
                </span>
            )
        },
        {
            key: 'id',
            label: 'Balance',
            align: 'right',
            render: (id) => formatIDR(groupedBalances.totalsById[id] || 0)
        },
        {
            key: 'action',
            label: 'Actions',
            render: (_, account) => {
                const deleteRules = canArchiveAccount(account, accounts);
                return (
                    <div className="inline-flex gap-1.5">
                        <Button
                            text="Edit"
                            size="small"
                            variant="tertiary"
                            icon={<PencilLine size={14} />}
                            onClick={() => openEdit(account)}
                        />
                        <Button
                            text={account.isActive ? 'Archive' : 'Activate'}
                            size="small"
                            variant="tertiary"
                            icon={account.isActive ? <Archive size={14} /> : <RotateCcw size={14} />}
                            onClick={() => handleToggleArchive(account)}
                        />
                        <Button
                            text="Delete"
                            size="small"
                            variant="tertiary"
                            icon={<Trash2 size={14} />}
                            disabled={!deleteRules.canDelete}
                            onClick={() => handleDelete(account)}
                        />
                    </div>
                );
            }
        }
    ];

    const lockReason = editingAccount?.hasPostings
        ? 'This account already has postings. Type and parent are locked.'
        : '';

    return (
        <ListPage
            containerClassName="max-w-full"
            title="Chart of Accounts"
            subtitle="Hierarchy, posting controls, and report grouping."
            actions={(
                <div className="flex gap-2 items-center">
                    <Button text="Import CoA" variant="secondary" icon={<Upload size={16} />} />
                    <Button text="Add Account" variant="primary" icon={<Plus size={16} />} onClick={openCreate} />
                </div>
            )}
        >
            {isLoading && (
                <div className="flex items-center gap-2 py-4 text-sm text-neutral-400">
                    <Loader size={16} className="animate-spin" /> Loading accounts…
                </div>
            )}

            <div className="grid grid-cols-[minmax(280px,1fr)_220px_170px_170px_auto] gap-2.5 items-center bg-neutral-0 border border-neutral-200 rounded-lg p-3 mb-4">
                <div className="relative flex items-center">
                    <Search size={16} className="absolute left-2.5 text-neutral-400 pointer-events-none" />
                    <input
                        className="block w-full px-3 pl-[34px] text-base leading-6 text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-[40px] transition-colors focus:border-primary-500 focus:outline-none focus:ring-3 focus:ring-primary-100"
                        placeholder="Search code, account, group..."
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                    />
                </div>
                <div className="min-w-0">
                    <select className="block w-full px-3 text-base leading-6 text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-[40px] transition-colors focus:border-primary-500 focus:outline-none focus:ring-3 focus:ring-primary-100" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
                        <option value="All">All Types</option>
                        {ACCOUNT_TYPES.map((type) => (
                            <option key={type} value={type}>{type}</option>
                        ))}
                    </select>
                </div>
                <div className="min-w-0">
                    <select className="block w-full px-3 text-base leading-6 text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-[40px] transition-colors focus:border-primary-500 focus:outline-none focus:ring-3 focus:ring-primary-100" value={activeFilter} onChange={(event) => setActiveFilter(event.target.value)}>
                        <option value="All">All Statuses</option>
                        <option value="Active">Active</option>
                        <option value="Archived">Archived</option>
                    </select>
                </div>
                <div className="min-w-0">
                    <select className="block w-full px-3 text-base leading-6 text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-[40px] transition-colors focus:border-primary-500 focus:outline-none focus:ring-3 focus:ring-primary-100" value={postableFilter} onChange={(event) => setPostableFilter(event.target.value)}>
                        <option value="All">All Modes</option>
                        <option value="Postable">Postable</option>
                        <option value="Group">Group</option>
                    </select>
                </div>
                <div className="min-w-0">
                    <select className="block w-full px-3 text-base leading-6 text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-[40px] transition-colors focus:border-primary-500 focus:outline-none focus:ring-3 focus:ring-primary-100" value={reportGroupFilter} onChange={(event) => setReportGroupFilter(event.target.value)}>
                        <option value="All">All Report Groups</option>
                        {reportGroups.map((group) => (
                            <option key={group} value={group}>{group}</option>
                        ))}
                    </select>
                </div>
            </div>

            <Card padding={false}>
                <Table columns={columns} data={filteredRows} showCount countLabel="accounts" />
            </Card>

            <Modal title={editingAccount ? 'Edit Account' : 'Add Account'} isOpen={isModalOpen} onClose={closeModal} size="lg">
                <div className="grid grid-cols-12 gap-x-4 gap-y-4">
                    <div className="col-span-4">
                        <Input
                            label="Account Code"
                            placeholder="e.g. 111"
                            value={form.code}
                            onChange={(event) => updateForm('code', event.target.value)}
                            error={errors.code}
                            wrapperClassName=""
                        />
                    </div>
                    <div className="col-span-8">
                        <Input
                            label="Account Name"
                            placeholder="e.g. Kas Kecil"
                            value={form.name}
                            onChange={(event) => updateForm('name', event.target.value)}
                            error={errors.name}
                            wrapperClassName=""
                        />
                    </div>
                    <div className="col-span-4">
                        <label className="form-label">Account Type</label>
                        <select
                            className={`block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)] disabled:bg-neutral-100 disabled:text-neutral-500 disabled:cursor-not-allowed ${errors.type ? 'border-danger-500' : 'border-neutral-300'}`}
                            value={form.type}
                            onChange={(event) => updateForm('type', event.target.value)}
                            disabled={Boolean(editingAccount?.hasPostings)}
                        >
                            {ACCOUNT_TYPES.map((type) => (
                                <option key={type} value={type}>{type}</option>
                            ))}
                        </select>
                        {errors.type ? <div className="mt-1 text-xs text-danger-500">{errors.type}</div> : null}
                    </div>
                    <div className="col-span-8">
                        <label className="form-label">Parent Account</label>
                        <select
                            className={`block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)] disabled:bg-neutral-100 disabled:text-neutral-500 disabled:cursor-not-allowed ${errors.parentId ? 'border-danger-500' : 'border-neutral-300'}`}
                            value={form.parentId}
                            onChange={(event) => updateForm('parentId', event.target.value)}
                            disabled={Boolean(editingAccount?.hasPostings)}
                        >
                            <option value="">No Parent (Root)</option>
                            {parentOptions.map((parent) => (
                                <option key={parent.id} value={parent.id}>{parent.code} {parent.name}</option>
                            ))}
                        </select>
                        {errors.parentId ? <div className="mt-1 text-xs text-danger-500">{errors.parentId}</div> : null}
                    </div>
                    <div className="col-span-6">
                        <Input
                            label="Report Group"
                            placeholder="e.g. Aset Lancar"
                            value={form.reportGroup}
                            onChange={(event) => updateForm('reportGroup', event.target.value)}
                            error={errors.reportGroup}
                            wrapperClassName=""
                        />
                    </div>
                    <div className="col-span-6">
                        <Input
                            label="Report Sub-group"
                            placeholder="e.g. Kas dan Bank"
                            value={form.reportSubGroup}
                            onChange={(event) => updateForm('reportSubGroup', event.target.value)}
                            wrapperClassName=""
                        />
                    </div>
                    <div className="col-span-6">
                        <label className="form-label">Posting Mode</label>
                        <select
                            className={`block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)] ${errors.isPostable ? 'border-danger-500' : 'border-neutral-300'}`}
                            value={form.isPostable ? 'Postable' : 'Group'}
                            onChange={(event) => updateForm('isPostable', event.target.value === 'Postable')}
                        >
                            <option value="Postable">Postable — can post journal entries directly</option>
                            <option value="Group">Group / Header — organises sub-accounts</option>
                        </select>
                        {errors.isPostable ? <div className="mt-1 text-xs text-danger-500">{errors.isPostable}</div> : null}
                    </div>
                    <div className="col-span-3">
                        <label className="form-label">Normal Side</label>
                        <input
                            className="block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-100 border border-neutral-300 rounded-md min-h-10 text-neutral-500 cursor-not-allowed"
                            value={getNormalSideByType(form.type)}
                            disabled
                            readOnly
                        />
                    </div>
                    <div className="col-span-3">
                        <label className="form-label">Status</label>
                        <select
                            className="block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                            value={form.isActive ? 'Active' : 'Archived'}
                            onChange={(event) => updateForm('isActive', event.target.value === 'Active')}
                        >
                            <option value="Active">Active</option>
                            <option value="Archived">Archived</option>
                        </select>
                    </div>
                    {lockReason ? (
                        <div className="col-span-12">
                            <div className="bg-warning-50 border border-warning-200 rounded-md text-warning-700 text-sm px-3 py-2">{lockReason}</div>
                        </div>
                    ) : null}
                    {errors._api && (
                        <div className="col-span-12">
                            <div className="bg-danger-50 border border-danger-200 rounded-md text-danger-700 text-sm px-3 py-2">{errors._api}</div>
                        </div>
                    )}
                    <div className="col-span-12 flex justify-end gap-2 pt-2 border-t border-neutral-200">
                        <Button text="Cancel" variant="secondary" onClick={closeModal} />
                        <Button
                            text={isSaving ? 'Saving…' : editingAccount ? 'Save Changes' : 'Save Account'}
                            variant="primary"
                            onClick={handleSaveAccount}
                            disabled={isSaving}
                        />
                    </div>
                </div>
            </Modal>
        </ListPage>
    );
};

export default ChartOfAccounts;
