import React, { useMemo, useState } from 'react';
import Card from '../../components/UI/Card';
import Button from '../../components/UI/Button';
import Input from '../../components/UI/Input';
import Modal from '../../components/UI/Modal';
import StatusTag from '../../components/UI/StatusTag';
import { Save, Plus, Edit2, Trash2, Clock, Shield, Check, UserPlus, UserMinus } from 'lucide-react';
import {
  useRoles,
  useCreateRole,
  useUpdateRole,
  useDeleteRole,
  useAssignUserRole,
  useCreateUser,
  type ApiRole,
  type ApiPermissionRow,
} from '../../hooks/useRoles';
import {
  useLoginAccounts,
  useAddMembership,
  useRemoveMembership,
  type LoginAccount,
} from '../../hooks/useUsers';
import { useAuthStore } from '../../stores/useAuthStore';
import { useToastStore } from '../../stores/useToastStore';
import {
  MODULE_DEFS,
  MODULE_DEFS_BY_GROUP,
  MODULE_GROUP_ORDER,
} from './moduleKeyMap';

/* ============================================================================
 * Users & Roles
 *
 * Relocated + DB-backed version of the old Settings → "Security & Roles" tab
 * (src/views/settings/SecurityRolesTab.tsx). Everything here reads from and
 * mutates the real database via the /api/v1/roles and /api/v1/users hooks
 * instead of the localStorage `useAccessStore` mock.
 *
 * Module-key mapping: the matrix is built from `MODULE_DEFS` (one row per
 * Prisma `enum ModuleKey` member — the API is the source of truth). Permission
 * rows round-trip as `{ moduleKey, canView, canCreate, canEdit, canDelete,
 * canApprove }`. Customer/vendor categories and fixed assets ride on the
 * AR_CUSTOMERS / AP_VENDORS / GL_JOURNAL rows. See moduleKeyMap.ts.
 * ========================================================================== */

const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const DEFAULT_ALLOWED_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

type PermFlag = 'canView' | 'canCreate' | 'canEdit' | 'canDelete' | 'canApprove';

/** Local editor model for a role being created/edited. */
interface RoleDraft {
  id: string | null; // null => new role (not yet persisted)
  name: string;
  roleType: string;
  isActive: boolean;
  allowedDays: string[];
  startTime: string;
  endTime: string;
  /** Permission rows keyed by ModuleKey, one per MODULE_DEFS entry. */
  permissions: Record<string, ApiPermissionRow>;
}

interface NewUserForm {
  fullName: string;
  email: string;
  roleId: string;
}

const blankPermRow = (moduleKey: string): ApiPermissionRow => ({
  moduleKey,
  canView: false,
  canCreate: false,
  canEdit: false,
  canDelete: false,
  canApprove: false,
});

/** Build a permission map covering every MODULE_DEFS row, all flags false. */
const emptyPermissionMap = (): Record<string, ApiPermissionRow> =>
  MODULE_DEFS.reduce((acc: Record<string, ApiPermissionRow>, def) => {
    acc[def.moduleKey] = blankPermRow(def.moduleKey);
    return acc;
  }, {});

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : 'Something went wrong. Please try again.';

const parseAllowedDays = (raw: unknown): string[] => {
  if (Array.isArray(raw)) return raw.filter((d): d is string => typeof d === 'string');
  return [...DEFAULT_ALLOWED_DAYS];
};

/** Hydrate a RoleDraft from an ApiRole, filling any missing module rows. */
const draftFromApiRole = (role: ApiRole): RoleDraft => {
  const permissions = emptyPermissionMap();
  for (const row of role.permissions || []) {
    // Only keep rows that map to a known module (the matrix is ModuleKey-driven).
    if (permissions[row.moduleKey]) {
      permissions[row.moduleKey] = {
        moduleKey: row.moduleKey,
        canView: row.canView === true,
        canCreate: row.canCreate === true,
        canEdit: row.canEdit === true,
        canDelete: row.canDelete === true,
        canApprove: row.canApprove === true,
      };
    }
  }
  return {
    id: role.id,
    name: role.name,
    roleType: role.roleType || 'CUSTOM',
    isActive: role.isActive,
    allowedDays: parseAllowedDays(role.allowedDays),
    startTime: role.startTime || '08:00',
    endTime: role.endTime || '17:00',
    permissions,
  };
};

const newRoleDraft = (): RoleDraft => ({
  id: null,
  name: 'New Role',
  roleType: 'CUSTOM',
  isActive: true,
  allowedDays: [...DEFAULT_ALLOWED_DAYS],
  startTime: '08:00',
  endTime: '17:00',
  permissions: emptyPermissionMap(),
});

const UsersAndRoles = (): React.ReactElement => {
  const roleType = useAuthStore((s) => s.roleType);
  const isAdmin = roleType === 'ADMIN';
  const currentUserId = useAuthStore((s) => s.user?.id) ?? null;
  const pushToast = useToastStore((s) => s.pushToast);

  /* ---- Server data ---- */
  const { data: roles = [], isLoading: rolesLoading } = useRoles();
  const { data: loginAccountsData, isLoading: loginAccountsLoading } = useLoginAccounts();
  // Memoize the source array — `?? []` produces a fresh reference every render,
  // which would defeat the downstream `activeAdminCount` useMemo (and is this
  // repo's known inline-`= []`-into-useMemo footgun; harmless here with no
  // useEffect consumer, but done right).
  const loginAccounts = useMemo<LoginAccount[]>(() => loginAccountsData?.data ?? [], [loginAccountsData]);

  /* ---- Mutations ---- */
  const createRole = useCreateRole();
  const updateRole = useUpdateRole();
  const deleteRole = useDeleteRole();
  const assignUserRole = useAssignUserRole();
  const createUser = useCreateUser();
  const addMembership = useAddMembership();
  const removeMembership = useRemoveMembership();

  /* ---- Local UI state ---- */
  const [editingRole, setEditingRole] = useState<RoleDraft | null>(null);
  const [activeGroup, setActiveGroup] = useState(MODULE_GROUP_ORDER[0]);
  const [showUserForm, setShowUserForm] = useState(false);
  const [newUser, setNewUser] = useState<NewUserForm>({ fullName: '', email: '', roleId: '' });
  const [savingRole, setSavingRole] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  // Shown once after a user is created — the API only returns the temp password
  // a single time.
  const [tempPasswordNotice, setTempPasswordNotice] = useState<{ email: string; password: string } | null>(null);
  // Tracks the role currently being assigned (disables that row's <select>).
  const [assigningUserId, setAssigningUserId] = useState<string | null>(null);
  // "Add existing user to this company" modal (invite by email + per-org role).
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteForm, setInviteForm] = useState<{ email: string; roleId: string }>({ email: '', roleId: '' });
  const [invitingMember, setInvitingMember] = useState(false);
  // Membership id currently being removed (disables that row's remove button).
  const [removingMembershipId, setRemovingMembershipId] = useState<string | null>(null);

  // Active admins in THIS company — the last one cannot be removed. This count is
  // only correct because the users list is unpaginated/unfiltered (one request
  // returns every active member); the DELETE endpoint's 422 last-admin guard is
  // the real enforcement — this just disables the button with an explanation.
  const activeAdminCount = useMemo(
    () => loginAccounts.filter((a) => a.roleType === 'ADMIN').length,
    [loginAccounts],
  );

  /* ---------------------------------------------------------------- handlers */

  const handleAddRole = (): void => {
    setEditingRole(newRoleDraft());
    setActiveGroup(MODULE_GROUP_ORDER[0]);
  };

  const handleEditRole = (role: ApiRole): void => {
    setEditingRole(draftFromApiRole(role));
    setActiveGroup(MODULE_GROUP_ORDER[0]);
  };

  const handleTogglePermission = (moduleKey: string, flag: PermFlag): void => {
    setEditingRole((prev) => {
      if (!prev) return prev;
      const current = prev.permissions[moduleKey] || blankPermRow(moduleKey);
      return {
        ...prev,
        permissions: {
          ...prev.permissions,
          [moduleKey]: { ...current, [flag]: !current[flag] },
        },
      };
    });
  };

  const handleToggleDay = (day: string): void => {
    setEditingRole((prev) => {
      if (!prev) return prev;
      const days = prev.allowedDays.includes(day)
        ? prev.allowedDays.filter((d) => d !== day)
        : [...prev.allowedDays, day];
      return { ...prev, allowedDays: days };
    });
  };

  const handleSelectAllGroup = (moduleKeys: string[], checked: boolean): void => {
    setEditingRole((prev) => {
      if (!prev) return prev;
      const permissions = { ...prev.permissions };
      for (const moduleKey of moduleKeys) {
        const current = permissions[moduleKey] || blankPermRow(moduleKey);
        permissions[moduleKey] = {
          ...current,
          canView: checked,
          canCreate: checked,
          canEdit: checked,
          canDelete: checked,
        };
      }
      return { ...prev, permissions };
    });
  };

  const handleSaveRole = async (): Promise<void> => {
    if (!editingRole) return;
    if (!editingRole.name.trim()) {
      window.alert('Role name is required.');
      return;
    }
    // The matrix already covers exactly the ModuleKey set, so the values are the
    // payload rows directly.
    const permissions = MODULE_DEFS.map((def) => editingRole.permissions[def.moduleKey] || blankPermRow(def.moduleKey));
    const payload = {
      name: editingRole.name.trim(),
      roleType: editingRole.roleType || 'CUSTOM',
      isActive: editingRole.isActive,
      allowedDays: editingRole.allowedDays,
      startTime: editingRole.startTime,
      endTime: editingRole.endTime,
      permissions,
    };

    setSavingRole(true);
    try {
      if (editingRole.id) {
        await updateRole.mutateAsync({ id: editingRole.id, ...payload });
      } else {
        await createRole.mutateAsync(payload);
      }
      setEditingRole(null);
    } catch (err) {
      window.alert(errorMessage(err));
    } finally {
      setSavingRole(false);
    }
  };

  const handleDeleteRole = async (role: ApiRole): Promise<void> => {
    if (!window.confirm(`Delete role "${role.name}"? This cannot be undone.`)) return;
    try {
      await deleteRole.mutateAsync(role.id);
    } catch (err) {
      window.alert(errorMessage(err));
    }
  };

  const handleChangeUserRole = async (userId: string, roleId: string): Promise<void> => {
    setAssigningUserId(userId);
    try {
      await assignUserRole.mutateAsync({ userId, roleId });
    } catch (err) {
      window.alert(errorMessage(err));
    } finally {
      setAssigningUserId(null);
    }
  };

  const handleAddUser = async (): Promise<void> => {
    if (!newUser.fullName.trim() || !newUser.email.trim()) {
      window.alert('Name and email are required.');
      return;
    }
    if (!newUser.roleId) {
      window.alert('Please choose a role for the new user.');
      return;
    }
    setCreatingUser(true);
    try {
      const result = await createUser.mutateAsync({
        fullName: newUser.fullName.trim(),
        email: newUser.email.trim(),
        roleId: newUser.roleId,
      });
      setNewUser({ fullName: '', email: '', roleId: roles[0]?.id ?? '' });
      setShowUserForm(false);
      if (result.temporaryPassword) {
        setTempPasswordNotice({ email: result.email, password: result.temporaryPassword });
      }
    } catch (err) {
      window.alert(errorMessage(err));
    } finally {
      setCreatingUser(false);
    }
  };

  const openInviteModal = (): void => {
    setInviteForm({ email: '', roleId: roles[0]?.id ?? '' });
    setShowInviteModal(true);
  };

  const handleInviteExisting = async (): Promise<void> => {
    const email = inviteForm.email.trim();
    if (!email) {
      pushToast('Enter the email of an existing user.', 'error');
      return;
    }
    if (!inviteForm.roleId) {
      pushToast('Choose a role for this company.', 'error');
      return;
    }
    setInvitingMember(true);
    try {
      await addMembership.mutateAsync({ email, roleId: inviteForm.roleId });
      setShowInviteModal(false);
      pushToast(`${email} was added to this company.`, 'success');
    } catch (err) {
      // Surface the server's 404 (unknown user) / 409 (already a member) message.
      pushToast(errorMessage(err), 'error');
    } finally {
      setInvitingMember(false);
    }
  };

  const handleRemoveMembership = async (acct: LoginAccount): Promise<void> => {
    if (!window.confirm(`Remove ${acct.fullName || acct.email} from this company?`)) return;
    setRemovingMembershipId(acct.membershipId);
    try {
      await removeMembership.mutateAsync(acct.membershipId);
      pushToast(`${acct.fullName || acct.email} was removed from this company.`, 'success');
    } catch (err) {
      // Surface the server's 422 (last administrator) / 404 message.
      pushToast(errorMessage(err), 'error');
    } finally {
      setRemovingMembershipId(null);
    }
  };

  /* ============================================================
     EDITING VIEW — Accurate-style Hak Akses grid
     ============================================================ */
  if (editingRole) {
    const activeModules = MODULE_DEFS_BY_GROUP[activeGroup] || [];
    const allChecked = activeModules.length > 0 && activeModules.every((m) => {
      const p = editingRole.permissions[m.moduleKey];
      return p?.canView && p?.canCreate && p?.canEdit && p?.canDelete;
    });

    return (
      <div className="container" style={{ maxWidth: 1200, margin: '0 auto', padding: '24px' }}>
        <Card title={`Edit Access Role — ${editingRole.name}`}>
          {/* Role name & active toggle */}
          <div className="grid grid-cols-12 gap-5 mb-6">
            <div className="col-span-6">
              <label className="block text-sm font-semibold text-neutral-700 mb-1">Role Name (Nama Group)</label>
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
                Role is Active
              </label>
            </div>
          </div>

          {/* Time/Day restrictions */}
          <div className="mb-6 p-4 bg-neutral-50 border border-neutral-200 rounded-lg">
            <h4 className="text-sm font-semibold text-neutral-800 mb-3 flex items-center gap-2">
              <Clock size={16} className="text-primary-600" />
              Access Schedule (Time &amp; Day)
              <span className="text-xs font-normal text-neutral-500">— Saved — not enforced yet</span>
            </h4>
            <div className="grid grid-cols-12 gap-5">
              <div className="col-span-6">
                <label className="block text-sm text-neutral-600 mb-2">Allowed Days</label>
                <div className="flex flex-wrap gap-2">
                  {DAYS_OF_WEEK.map((day) => {
                    const isSelected = editingRole.allowedDays.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
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
            Module Permissions (Hak Akses)
          </h4>

          <div className="flex border border-neutral-200 rounded-lg overflow-hidden mb-6" style={{ minHeight: 360 }}>
            {/* Left: module group list */}
            <div className="w-52 shrink-0 border-r border-neutral-200 bg-neutral-50 overflow-y-auto">
              {MODULE_GROUP_ORDER.map((group) => {
                if (!MODULE_DEFS_BY_GROUP[group]) return null;
                const isActive = activeGroup === group;
                return (
                  <button
                    key={group}
                    type="button"
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
                    <th className="p-3 text-sm font-semibold text-neutral-700">Permission</th>
                    <th className="p-3 text-sm font-semibold text-neutral-700 text-center w-20">View</th>
                    <th className="p-3 text-sm font-semibold text-neutral-700 text-center w-20">Create</th>
                    <th className="p-3 text-sm font-semibold text-neutral-700 text-center w-20">Edit</th>
                    <th className="p-3 text-sm font-semibold text-neutral-700 text-center w-20">Delete</th>
                    <th className="p-3 text-sm font-semibold text-neutral-700 text-center w-20">Approve</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Select-all row (CRUD only — Approve excluded, matching the old UI) */}
                  <tr className="bg-neutral-50 border-b border-neutral-200">
                    <td className="p-3 text-sm font-semibold text-neutral-600">Select All (View/Create/Edit/Delete)</td>
                    <td className="p-3 text-center">
                      <label className="inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={allChecked}
                          onChange={(e) => handleSelectAllGroup(activeModules.map((m) => m.moduleKey), e.target.checked)}
                          className="w-4 h-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
                        />
                      </label>
                    </td>
                    <td className="p-3" />
                    <td className="p-3" />
                    <td className="p-3" />
                    <td className="p-3" />
                  </tr>

                  {/* Individual modules */}
                  {activeModules.map((mod, idx) => {
                    const perm = editingRole.permissions[mod.moduleKey] || blankPermRow(mod.moduleKey);
                    const cols: PermFlag[] = ['canView', 'canCreate', 'canEdit', 'canDelete', 'canApprove'];
                    return (
                      <tr
                        key={mod.moduleKey}
                        className={idx !== activeModules.length - 1 ? 'border-b border-neutral-100' : ''}
                      >
                        <td className="p-3 pl-6 text-sm font-medium text-neutral-800">{mod.label}</td>
                        {cols.map((flag) => (
                          <td key={flag} className="p-3 text-center align-middle">
                            <label className="inline-flex items-center cursor-pointer">
                              <input
                                type="checkbox"
                                checked={perm[flag] === true}
                                onChange={() => handleTogglePermission(mod.moduleKey, flag)}
                                className="w-4 h-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500 hidden peer"
                              />
                              <div className="w-5 h-5 rounded border border-neutral-300 peer-checked:bg-primary-500 peer-checked:border-primary-500 flex items-center justify-center transition-colors">
                                {perm[flag] === true && <Check size={14} className="text-white" />}
                              </div>
                            </label>
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex gap-3 mt-4">
            <Button
              text={savingRole ? 'Saving…' : 'Save Role'}
              variant="primary"
              icon={<Save size={16} />}
              loading={savingRole}
              onClick={handleSaveRole}
            />
            <Button text="Cancel" variant="secondary" disabled={savingRole} onClick={() => setEditingRole(null)} />
          </div>
        </Card>
      </div>
    );
  }

  /* ============================================================
     LIST VIEW — Users + Roles
     ============================================================ */
  return (
    <div className="container" style={{ maxWidth: 1200, margin: '0 auto', padding: '24px' }}>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-bold text-neutral-900">Users &amp; Roles</h1>
      </div>

      <div className="flex flex-col gap-5">
        {/* Temp password notice (shown once after creating a user) */}
        {tempPasswordNotice && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 flex items-start justify-between gap-4">
            <div className="text-sm text-amber-900">
              <div className="font-semibold mb-1">User created — copy this temporary password now.</div>
              <div>
                {tempPasswordNotice.email} —{' '}
                <code className="px-1.5 py-0.5 bg-white border border-amber-300 rounded font-mono text-amber-800">
                  {tempPasswordNotice.password}
                </code>
              </div>
              <div className="mt-1 text-xs text-amber-700">
                It will not be shown again. The user must change it at first login.
              </div>
            </div>
            <Button text="Dismiss" size="small" variant="secondary" onClick={() => setTempPasswordNotice(null)} />
          </div>
        )}

        {/* Users */}
        <Card
          title="Users Directory"
          actions={
            <div className="flex items-center gap-2">
              <Button
                text="Add user to this company"
                variant="secondary"
                icon={<UserPlus size={16} />}
                disabled={!isAdmin}
                onClick={openInviteModal}
              />
              <Button
                text="Add User"
                variant="secondary"
                icon={<Plus size={16} />}
                disabled={!isAdmin}
                onClick={() => {
                  setShowUserForm((v) => !v);
                  setNewUser((u) => ({ ...u, roleId: u.roleId || roles[0]?.id || '' }));
                }}
              />
            </div>
          }
          padding={false}
        >
          {showUserForm && (
            <div className="p-4 border-b border-neutral-200 bg-neutral-50">
              <div className="grid grid-cols-12 gap-4 items-end">
                <div className="col-span-3">
                  <label className="block text-xs font-semibold text-neutral-600 mb-1">Name</label>
                  <Input
                    value={newUser.fullName}
                    onChange={(e) => setNewUser({ ...newUser, fullName: e.target.value })}
                    placeholder="John Doe"
                  />
                </div>
                <div className="col-span-3">
                  <label className="block text-xs font-semibold text-neutral-600 mb-1">Email</label>
                  <Input
                    type="email"
                    value={newUser.email}
                    onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                    placeholder="john@msm.com"
                  />
                </div>
                <div className="col-span-3">
                  <label className="block text-xs font-semibold text-neutral-600 mb-1">Role</label>
                  <select
                    className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                    value={newUser.roleId}
                    onChange={(e) => setNewUser({ ...newUser, roleId: e.target.value })}
                  >
                    <option value="">Select a role…</option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-3 flex gap-2 h-10">
                  <Button
                    text={creatingUser ? 'Saving…' : 'Save'}
                    variant="primary"
                    loading={creatingUser}
                    onClick={handleAddUser}
                    className="w-full"
                  />
                  <Button text="Cancel" variant="secondary" disabled={creatingUser} onClick={() => setShowUserForm(false)} />
                </div>
              </div>
            </div>
          )}

          <div className="overflow-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-neutral-50 border-b border-neutral-200">
                <tr>
                  <th className="p-3 text-sm font-semibold text-neutral-700">Name</th>
                  <th className="p-3 text-sm font-semibold text-neutral-700">Email</th>
                  <th className="p-3 text-sm font-semibold text-neutral-700">Status</th>
                  <th className="p-3 text-sm font-semibold text-neutral-700 w-56">Role</th>
                  <th className="p-3 text-sm font-semibold text-neutral-700 w-40 text-right">Access</th>
                </tr>
              </thead>
              <tbody>
                {loginAccounts.map((acct) => {
                  // Match the user's current role by name (the login-accounts API
                  // returns roleName, not roleId).
                  const currentRole = roles.find((r) => r.name === acct.roleName);
                  const isSelf = acct.id === currentUserId;
                  const isLastAdmin = acct.roleType === 'ADMIN' && activeAdminCount <= 1;
                  const removing = removingMembershipId === acct.membershipId;
                  const removeDisabled = !isAdmin || isSelf || isLastAdmin || removing;
                  const removeTitle = isSelf
                    ? 'You cannot remove yourself from this company.'
                    : isLastAdmin
                      ? 'The company must keep at least one administrator.'
                      : 'Remove this user from this company.';
                  return (
                    <tr key={acct.id} className="border-b border-neutral-100 last:border-0">
                      <td className="p-3 text-sm font-medium text-neutral-800">{acct.fullName}</td>
                      <td className="p-3 text-sm text-neutral-600">{acct.email}</td>
                      <td className="p-3"><StatusTag status={acct.status} /></td>
                      <td className="p-3">
                        <select
                          className="w-full h-9 px-2 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0 disabled:bg-neutral-100 disabled:cursor-not-allowed"
                          value={currentRole?.id ?? ''}
                          disabled={!isAdmin || assigningUserId === acct.id}
                          onChange={(e) => handleChangeUserRole(acct.id, e.target.value)}
                        >
                          {!currentRole && <option value="">{acct.roleName || 'Unknown'}</option>}
                          {roles.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="p-3 text-right">
                        <button
                          type="button"
                          title={removeTitle}
                          disabled={removeDisabled}
                          onClick={() => handleRemoveMembership(acct)}
                          className={`inline-flex items-center gap-1.5 text-sm font-medium transition-colors ${
                            removeDisabled
                              ? 'text-neutral-300 cursor-not-allowed'
                              : 'text-danger-600 hover:text-danger-700'
                          }`}
                          aria-label={`Remove ${acct.fullName || acct.email} from this company`}
                        >
                          <UserMinus size={15} />
                          {removing ? 'Removing…' : 'Remove'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {loginAccountsLoading && loginAccounts.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-4 text-sm text-neutral-500 text-center">
                      Loading users…
                    </td>
                  </tr>
                )}
                {!loginAccountsLoading && loginAccounts.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-4 text-sm text-neutral-500 text-center">
                      No users found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Roles */}
        <Card
          title="Access Roles & Permissions"
          actions={
            <Button
              text="Create Role"
              variant="primary"
              icon={<Plus size={16} />}
              disabled={!isAdmin}
              onClick={handleAddRole}
            />
          }
          padding={false}
        >
          <div className="overflow-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-neutral-50 border-b border-neutral-200">
                <tr>
                  <th className="p-3 text-sm font-semibold text-neutral-700">Role Name</th>
                  <th className="p-3 text-sm font-semibold text-neutral-700 w-24">Users</th>
                  <th className="p-3 text-sm font-semibold text-neutral-700 w-28">Status</th>
                  <th className="p-3 text-sm font-semibold text-neutral-700 w-24 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {roles.map((role) => (
                  <tr key={role.id} className="border-b border-neutral-100 last:border-0">
                    <td className="p-3 text-sm font-semibold text-neutral-800">
                      {role.name}
                      {role.roleType === 'ADMIN' && (
                        <span className="ml-2 text-xs font-normal text-neutral-500">(System)</span>
                      )}
                    </td>
                    <td className="p-3 text-sm text-neutral-600">{role.memberCount}</td>
                    <td className="p-3"><StatusTag status={role.isActive ? 'Active' : 'Inactive'} /></td>
                    <td className="p-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          className={`text-neutral-500 transition-colors ${isAdmin ? 'hover:text-primary-600' : 'opacity-60 cursor-not-allowed'}`}
                          disabled={!isAdmin}
                          onClick={() => handleEditRole(role)}
                          aria-label={`Edit ${role.name}`}
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          type="button"
                          className={`text-neutral-500 transition-colors ${isAdmin ? 'hover:text-danger-600' : 'opacity-60 cursor-not-allowed'}`}
                          disabled={!isAdmin}
                          onClick={() => handleDeleteRole(role)}
                          aria-label={`Delete ${role.name}`}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {roles.length === 0 && !rolesLoading && (
                  <tr>
                    <td colSpan={4} className="p-4 text-sm text-neutral-500 text-center">
                      No roles found.
                    </td>
                  </tr>
                )}
                {rolesLoading && (
                  <tr>
                    <td colSpan={4} className="p-4 text-sm text-neutral-500 text-center">
                      Loading roles…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {!isAdmin && (
          <p className="text-sm text-neutral-500">
            You have read-only access. Only administrators can create or modify roles and users.
          </p>
        )}
      </div>

      {/* Add existing user to this company (invite by email + per-company role) */}
      <Modal
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        title="Add user to this company"
        size="sm"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-neutral-600">
            Grant an <span className="font-medium">existing</span> user access to this company with a
            role. To create a brand-new account, use “Add User” instead.
          </p>
          <div>
            <label className="block text-xs font-semibold text-neutral-600 mb-1">Email</label>
            <Input
              type="email"
              value={inviteForm.email}
              onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
              placeholder="user@company.com"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-neutral-600 mb-1">Role in this company</label>
            <select
              className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
              value={inviteForm.roleId}
              onChange={(e) => setInviteForm({ ...inviteForm, roleId: e.target.value })}
            >
              <option value="">Select a role…</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              text="Cancel"
              variant="secondary"
              disabled={invitingMember}
              onClick={() => setShowInviteModal(false)}
            />
            <Button
              text={invitingMember ? 'Adding…' : 'Add to company'}
              variant="primary"
              loading={invitingMember}
              onClick={handleInviteExisting}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default UsersAndRoles;
