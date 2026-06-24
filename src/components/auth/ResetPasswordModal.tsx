import React, { useState } from 'react';
import Modal from '../UI/Modal';
import Input from '../UI/Input';
import Button from '../UI/Button';
import { useResetUserPassword, type LoginAccount } from '../../hooks/useUsers';

interface ResetPasswordModalProps {
  account: LoginAccount | null;
  onClose: () => void;
}

export default function ResetPasswordModal({ account, onClose }: ResetPasswordModalProps): React.ReactElement {
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const resetPassword = useResetUserPassword();

  const handleClose = () => {
    setNewPassword(''); setConfirm(''); setError(null); setDone(false); onClose();
  };

  const handleSubmit = async () => {
    if (!account) return;
    setError(null);
    if (newPassword !== confirm) { setError('Password and confirmation do not match.'); return; }
    try {
      await resetPassword.mutateAsync({ userId: account.id, newPassword });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reset password.');
    }
  };

  return (
    <Modal isOpen={account !== null} onClose={handleClose}
      title={`Reset password — ${account?.fullName ?? ''}`} size="sm">
      <div className="p-6">
        {done ? (
          <>
            <p className="text-sm text-neutral-700 mb-4">
              Temporary password set for <strong>{account?.email}</strong>. Share it with them
              securely — they will be required to choose their own password at next login.
            </p>
            <div className="flex justify-end">
              <Button text="Done" variant="primary" onClick={handleClose} />
            </div>
          </>
        ) : (
          <>
            <Input label="Temporary password" type="password" value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)} required />
            <Input label="Confirm password" type="password" value={confirm}
              onChange={(e) => setConfirm(e.target.value)} required />
            <p className="text-xs text-neutral-500 -mt-2 mb-3">
              At least 8 characters, including a letter and a number.
            </p>
            {error && <p className="text-sm text-danger-600 mb-3">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button text="Cancel" variant="secondary" onClick={handleClose} />
              <Button text="Reset Password" variant="primary" loading={resetPassword.isPending}
                disabled={!newPassword || !confirm} onClick={handleSubmit} />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
