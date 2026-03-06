import React, { useState } from 'react';
import Card from '../../components/UI/Card';
import Button from '../../components/UI/Button';
import Input from '../../components/UI/Input';
import Table from '../../components/UI/Table';
import StatusTag from '../../components/UI/StatusTag';
import { Save, Plus, Edit2, Trash2, Clock, Shield, Check, ToggleLeft, ToggleRight } from 'lucide-react';
import { useAccessStore, MODULE_KEYS, noPermissions } from '../../stores/useAccessStore';

const daysOfWeek = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Accurate-style module category sidebar for the permission matrix.
 * Groups MODULE_KEYS by their `group` field.
 */
const moduleGroups = Object.entries(MODULE_KEYS).reduce((acc, [key, info]) => {
    if (!acc[info.group]) acc[info.group] = [];
    acc[info.group].push({ key, label: info.label });
    return acc;
}, {});

const groupOrder = [
    'Dashboard', 'General Ledger', 'Accounts Receivable', 'Accounts Payable',
    'Inventory', 'HR & Payroll', 'Banking', 'Integrations', 'Reports', 'Company', 'Settings'
];

const SecurityRolesTab = ({ securitySettings, setSecuritySettings, onSave }) => {
    /* ---- Pull from Zustand store ---- */
    const roles = useAccessStore(s => s.roles);
    const users = useAccessStore(s => s.users);
    const addRole = useAccessStore(s => s.addRole);
    const updateRole = useAccessStore(s => s.updateRole);
    const deleteRole = useAccessStore(s => s.deleteRole);
    const addUser = useAccessStore(s => s.addUser);
    const deleteUser = useAccessStore(s => s.deleteUser);

    /* ---- Local UI state ---- */
    const [editingRole, setEditingRole] = useState(null);
    const [activeGroup, setActiveGroup] = useState('Dashboard');
    const [showUserForm, setShowUserForm] = useState(false);
    const [newUser, setNewUser] = useState({ name: '', email: '', roleId: roles[0]?.id || '' });

    /* ---- Handlers ---- */
    const handleAddRole = () => {
        setEditingRole({
            id: `role_${Date.now()}`,
            name: 'New Role',
            isActive: true,
            allowedDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
            startTime: '08:00',
            endTime: '17:00',
            permissions: noPermissions(),
        });
        setActiveGroup('Dashboard');
    };

    const handleSaveRole = () => {
        const exists = roles.find(r => r.id === editingRole.id);
        if (exists) {
            updateRole(editingRole);
        } else {
            addRole(editingRole);
        }
        setEditingRole(null);
    };

    const handleTogglePermission = (modKey, action) => {
        setEditingRole(prev => ({
            ...prev,
            permissions: {
                ...prev.permissions,
                [modKey]: {
                    ...prev.permissions[modKey],
                    [action]: !prev.permissions[modKey][action]
                }
            }
        }));
    };

    const handleToggleDay = (day) => {
        setEditingRole(prev => {
            const days = prev.allowedDays.includes(day)
                ? prev.allowedDays.filter(d => d !== day)
                : [...prev.allowedDays, day];
            return { ...prev, allowedDays: days };
        });
    };

    const handleSelectAllGroup = (groupKeys, checked) => {
        setEditingRole(prev => {
            const perms = { ...prev.permissions };
            groupKeys.forEach(({ key }) => {
                perms[key] = {
                    view: checked,
                    create: checked,
                    edit: checked,
                    delete: checked,
                };
            });
            return { ...prev, permissions: perms };
        });
    };

    const handleAddUser = () => {
        if (!newUser.name || !newUser.email) return;
        addUser(newUser);
        setNewUser({ name: '', email: '', roleId: roles[0]?.id || '' });
        setShowUserForm(false);
    };

    /* ---- Table Columns ---- */
    const userColumns = [
        { key: 'name', label: 'Name' },
        { key: 'email', label: 'Email' },
        { key: 'role', label: 'Role', render: (_, user) => roles.find(r => r.id === user.roleId)?.name || 'Unknown' },
        { key: 'status', label: 'Status', render: (val) => <StatusTag status={val} /> }
    ];

    const roleColumns = [
        { key: 'name', label: 'Role Name', render: (val) => <span className="font-semibold">{val}</span> },
        { key: 'users', label: 'Users', render: (_, row) => users.filter(u => u.roleId === row.id).length },
        { key: 'status', label: 'Status', render: (_, row) => <StatusTag status={row.isActive ? 'Active' : 'Inactive'} /> },
        {
            key: 'actions', label: '', render: (_, row) => (
                <button
                    className="text-neutral-500 hover:text-primary-600 transition-colors"
                    onClick={() => { setEditingRole({ ...row, permissions: { ...noPermissions(), ...row.permissions } }); setActiveGroup('Dashboard'); }}
                >
                    <Edit2 size={16} />
                </button>
            )
        }
    ];

    /* ============================================================
       EDITING VIEW — Accurate-style Hak Akses grid
       ============================================================ */
    if (editingRole) {
        const activeModules = moduleGroups[activeGroup] || [];
        const allChecked = activeModules.every(m =>
            editingRole.permissions[m.key]?.view &&
            editingRole.permissions[m.key]?.create &&
            editingRole.permissions[m.key]?.edit &&
            editingRole.permissions[m.key]?.delete
        );

        return (
            <Card title={`Edit Access Role — ${editingRole.name}`}>
                {/* Role name & active toggle */}
                <div className="grid grid-cols-12 gap-5 mb-6">
                    <div className="col-span-6">
                        <label className="block text-sm font-semibold text-neutral-700 mb-1">Nama Group (Role Name)</label>
                        <Input
                            value={editingRole.name}
                            onChange={(e) => setEditingRole({ ...editingRole, name: e.target.value })}
                        />
                    </div>
                    <div className="col-span-6 flex items-center pt-6">
                        <label className="flex items-center gap-2 cursor-pointer font-medium text-neutral-700 select-none">
                            <input
                                type="checkbox"
                                checked={editingRole.isActive}
                                onChange={(e) => setEditingRole({ ...editingRole, isActive: e.target.checked })}
                                className="w-4 h-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
                            />
                            Role is Active (Aktif)
                        </label>
                    </div>
                </div>

                {/* Time/Day restrictions */}
                <div className="mb-6 p-4 bg-neutral-50 border border-neutral-200 rounded-lg">
                    <h4 className="text-sm font-semibold text-neutral-800 mb-3 flex items-center gap-2">
                        <Clock size={16} className="text-primary-600" />
                        Pembatasan Akses (Access Restrictions — Time & Day)
                    </h4>
                    <div className="grid grid-cols-12 gap-5">
                        <div className="col-span-6">
                            <label className="block text-sm text-neutral-600 mb-2">Allowed Days</label>
                            <div className="flex flex-wrap gap-2">
                                {daysOfWeek.map(day => {
                                    const isSelected = editingRole.allowedDays.includes(day);
                                    return (
                                        <button
                                            key={day}
                                            onClick={() => handleToggleDay(day)}
                                            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${isSelected ? 'bg-primary-100 border-primary-200 text-primary-800' : 'bg-white border-neutral-200 text-neutral-500 hover:border-neutral-300'}`}
                                        >
                                            {day}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        <div className="col-span-3">
                            <label className="block text-sm text-neutral-600 mb-1">Start Time</label>
                            <Input
                                type="time"
                                value={editingRole.startTime}
                                onChange={(e) => setEditingRole({ ...editingRole, startTime: e.target.value })}
                            />
                        </div>
                        <div className="col-span-3">
                            <label className="block text-sm text-neutral-600 mb-1">End Time</label>
                            <Input
                                type="time"
                                value={editingRole.endTime}
                                onChange={(e) => setEditingRole({ ...editingRole, endTime: e.target.value })}
                            />
                        </div>
                    </div>
                </div>

                {/* Hak Akses — Accurate-style split layout */}
                <h4 className="text-sm font-semibold text-neutral-800 mb-3 flex items-center gap-2">
                    <Shield size={16} className="text-primary-600" />
                    Hak Akses (Module Permissions)
                </h4>

                <div className="flex border border-neutral-200 rounded-lg overflow-hidden mb-6" style={{ minHeight: 360 }}>
                    {/* Left: module group list (like Accurate's sidebar) */}
                    <div className="w-52 shrink-0 border-r border-neutral-200 bg-neutral-50 overflow-y-auto">
                        {groupOrder.map(group => {
                            if (!moduleGroups[group]) return null;
                            const isActive = activeGroup === group;
                            return (
                                <button
                                    key={group}
                                    onClick={() => setActiveGroup(group)}
                                    className={`w-full text-left px-4 py-3 text-sm font-medium transition-colors border-b border-neutral-100 ${
                                        isActive
                                            ? 'bg-white text-red-600 border-l-2 border-l-red-500'
                                            : 'text-neutral-700 hover:bg-neutral-100 border-l-2 border-l-transparent'
                                    }`}
                                >
                                    {group}
                                </button>
                            );
                        })}
                    </div>

                    {/* Right: permission checkboxes for selected group */}
                    <div className="flex-1 overflow-auto">
                        <table className="w-full text-left border-collapse bg-white">
                            <thead className="bg-neutral-100 border-b border-neutral-200 sticky top-0">
                                <tr>
                                    <th className="p-3 text-sm font-semibold text-neutral-700">Hak Akses</th>
                                    <th className="p-3 text-sm font-semibold text-neutral-700 text-center w-20">Aktif</th>
                                    <th className="p-3 text-sm font-semibold text-neutral-700 text-center w-20">Buat</th>
                                    <th className="p-3 text-sm font-semibold text-neutral-700 text-center w-20">Ubah</th>
                                    <th className="p-3 text-sm font-semibold text-neutral-700 text-center w-20">Hapus</th>
                                    <th className="p-3 text-sm font-semibold text-neutral-700 text-center w-20">Lihat</th>
                                </tr>
                            </thead>
                            <tbody>
                                {/* Select-all row */}
                                <tr className="bg-neutral-50 border-b border-neutral-200">
                                    <td className="p-3 text-sm font-semibold text-neutral-600">Select All</td>
                                    {['view', 'create', 'edit', 'delete', 'view'].map((action, i) => {
                                        if (i === 0) {
                                            // "Aktif" = select all toggle
                                            return (
                                                <td key="selectall" className="p-3 text-center">
                                                    <label className="inline-flex items-center cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={allChecked}
                                                            onChange={(e) => handleSelectAllGroup(activeModules, e.target.checked)}
                                                            className="w-4 h-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
                                                        />
                                                    </label>
                                                </td>
                                            );
                                        }
                                        return null;
                                    })}
                                    {/* Empty cells for the other columns in select-all row */}
                                    <td className="p-3"></td>
                                    <td className="p-3"></td>
                                    <td className="p-3"></td>
                                    <td className="p-3"></td>
                                </tr>

                                {/* Akses Menu header */}
                                <tr className="bg-neutral-50/50">
                                    <td colSpan="6" className="px-3 py-2 text-xs font-bold text-neutral-500 uppercase tracking-wider">
                                        Akses Menu
                                    </td>
                                </tr>

                                {/* Individual modules */}
                                {activeModules.map((mod, idx) => (
                                    <tr key={mod.key} className={idx !== activeModules.length - 1 ? 'border-b border-neutral-100' : ''}>
                                        <td className="p-3 pl-6 text-sm font-medium text-neutral-800">{mod.label}</td>
                                        {['view', 'create', 'edit', 'delete', 'view'].map((action, i) => {
                                            // Column order: Aktif(view), Buat(create), Ubah(edit), Hapus(delete), Lihat(view)
                                            // We use: view for Aktif, create for Buat, edit for Ubah, delete for Hapus, view for Lihat
                                            // To match Accurate: Aktif = view, Buat = create, Ubah = edit, Hapus = delete, Lihat = view
                                            // Since Aktif and Lihat both map to "view", we'll treat them separately:
                                            // Aktif toggles all on/off, Lihat is the view permission
                                            const realActions = ['view', 'create', 'edit', 'delete', 'view'];
                                            const realAction = realActions[i];

                                            // For "Aktif" column (index 0), it controls whether the row is enabled
                                            // For "Lihat" column (index 4), it's the view permission
                                            // They share the same underlying "view" field (like Accurate)
                                            if (i === 0 || i === 4) {
                                                // Both Aktif and Lihat map to view
                                                return (
                                                    <td key={`${action}-${i}`} className="p-3 text-center align-middle">
                                                        <label className="inline-flex items-center cursor-pointer">
                                                            <input
                                                                type="checkbox"
                                                                checked={editingRole.permissions[mod.key]?.[realAction] || false}
                                                                onChange={() => handleTogglePermission(mod.key, realAction)}
                                                                className="w-4 h-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500 hidden peer"
                                                            />
                                                            <div className="w-5 h-5 rounded border border-neutral-300 peer-checked:bg-primary-500 peer-checked:border-primary-500 flex items-center justify-center transition-colors">
                                                                {editingRole.permissions[mod.key]?.[realAction] && <Check size={14} className="text-white" />}
                                                            </div>
                                                        </label>
                                                    </td>
                                                );
                                            }

                                            return (
                                                <td key={`${action}-${i}`} className="p-3 text-center align-middle">
                                                    <label className="inline-flex items-center cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={editingRole.permissions[mod.key]?.[realAction] || false}
                                                            onChange={() => handleTogglePermission(mod.key, realAction)}
                                                            className="w-4 h-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500 hidden peer"
                                                        />
                                                        <div className="w-5 h-5 rounded border border-neutral-300 peer-checked:bg-primary-500 peer-checked:border-primary-500 flex items-center justify-center transition-colors">
                                                            {editingRole.permissions[mod.key]?.[realAction] && <Check size={14} className="text-white" />}
                                                        </div>
                                                    </label>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="flex gap-3 mt-4">
                    <Button text="Save Role" variant="primary" icon={<Save size={16} />} onClick={handleSaveRole} />
                    <Button text="Cancel" variant="secondary" onClick={() => setEditingRole(null)} />
                </div>
            </Card>
        );
    }

    /* ============================================================
       LIST VIEW — Roles + Users tables
       ============================================================ */
    return (
        <div className="flex flex-col gap-5">
            <Card
                title="Users Directory (Daftar Pengguna)"
                actions={<Button text="Add User" variant="secondary" icon={<Plus size={16} />} onClick={() => setShowUserForm(!showUserForm)} />}
                padding={false}
            >
                {showUserForm && (
                    <div className="p-4 border-b border-neutral-200 bg-neutral-50 mb-0">
                        <div className="grid grid-cols-12 gap-4 items-end">
                            <div className="col-span-3">
                                <label className="block text-xs font-semibold text-neutral-600 mb-1">Name</label>
                                <Input value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} placeholder="John Doe" />
                            </div>
                            <div className="col-span-3">
                                <label className="block text-xs font-semibold text-neutral-600 mb-1">Email</label>
                                <Input type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} placeholder="john@msm.com" />
                            </div>
                            <div className="col-span-3">
                                <label className="block text-xs font-semibold text-neutral-600 mb-1">Role (Akses Group)</label>
                                <select
                                    className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                                    value={newUser.roleId}
                                    onChange={(e) => setNewUser({ ...newUser, roleId: e.target.value })}
                                >
                                    {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                </select>
                            </div>
                            <div className="col-span-3 flex gap-2 h-10">
                                <Button text="Save" variant="primary" onClick={handleAddUser} className="w-full" />
                                <Button text="Cancel" variant="secondary" onClick={() => setShowUserForm(false)} />
                            </div>
                        </div>
                    </div>
                )}
                <div className="p-0">
                    <Table columns={userColumns} data={users} />
                </div>
            </Card>

            <Card
                title="Access Roles & Permissions (Akses Grup)"
                actions={<Button text="Create Role" variant="primary" icon={<Plus size={16} />} onClick={handleAddRole} />}
                padding={false}
            >
                <Table columns={roleColumns} data={roles} />
            </Card>

            <Card title="Global Security Settings">
                <p className="settings-muted">System-wide security controls that apply regardless of role.</p>
                <div className="mb-4">
                    <label className="flex items-center gap-2 cursor-pointer font-medium text-neutral-700 select-none">
                        <input
                            type="checkbox"
                            checked={securitySettings.require2FA}
                            onChange={(e) => setSecuritySettings((prev) => ({ ...prev, require2FA: e.target.checked }))}
                            className="w-4 h-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
                        />
                        Require 2FA for all users
                    </label>
                </div>
                <div className="mb-4">
                    <label className="flex items-center gap-2 cursor-pointer font-medium text-neutral-700 select-none">
                        <input
                            type="checkbox"
                            checked={securitySettings.allowInvites}
                            onChange={(e) => setSecuritySettings((prev) => ({ ...prev, allowInvites: e.target.checked }))}
                            className="w-4 h-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
                        />
                        Allow administrators to invite new users
                    </label>
                </div>
                <div className="mb-4">
                    <label className="block text-sm font-semibold text-neutral-700 mb-1">Idle Session Timeout (minutes)</label>
                    <div className="w-[200px]">
                        <Input
                            type="number"
                            value={securitySettings.sessionTimeoutMinutes}
                            onChange={(e) => setSecuritySettings((prev) => ({ ...prev, sessionTimeoutMinutes: e.target.value }))}
                        />
                    </div>
                </div>
                <div className="mt-5">
                    <Button text="Save Settings" variant="primary" icon={<Save size={16} />} onClick={onSave} />
                </div>
            </Card>
        </div>
    );
};

export default SecurityRolesTab;
