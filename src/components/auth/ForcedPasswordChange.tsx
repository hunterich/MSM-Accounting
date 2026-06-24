import React, { useState } from 'react';
import Input from '../UI/Input';
import Button from '../UI/Button';
import { useChangeOwnPassword } from '../../hooks/useUsers';
import { useAuthStore } from '../../stores/useAuthStore';

export default function ForcedPasswordChange(): React.ReactElement {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const changePassword = useChangeOwnPassword();
  const logout = useAuthStore((s) => s.logout);

  const handleSubmit = async () => {
    setError(null);
    if (newPassword !== confirm) { setError('New password and confirmation do not match.'); return; }
    try {
      // On success the hook clears mustChangePassword, which unmounts this screen.
      await changePassword.mutateAsync({ currentPassword, newPassword });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to change password.');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-6">
      <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-neutral-900">Set a new password</h1>
        <p className="mt-2 mb-5 text-sm leading-6 text-neutral-600">
          Your password was reset by an administrator. Choose a new password to continue.
        </p>
        <Input label="Temporary password" type="password" value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)} required />
        <Input label="New password" type="password" value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)} required />
        <Input label="Confirm new password" type="password" value={confirm}
          onChange={(e) => setConfirm(e.target.value)} required />
        <p className="text-xs text-neutral-500 -mt-2 mb-3">
          At least 8 characters, including a letter and a number.
        </p>
        {error && <p className="text-sm text-danger-600 mb-3">{error}</p>}
        <div className="flex justify-between gap-2">
          <Button text="Logout" variant="ghost" onClick={() => logout()} />
          <Button text="Set Password" variant="primary" loading={changePassword.isPending}
            disabled={!currentPassword || !newPassword || !confirm} onClick={handleSubmit} />
        </div>
      </div>
    </div>
  );
}
