import React, { useState } from 'react';
import Modal from '../UI/Modal';
import Input from '../UI/Input';
import Button from '../UI/Button';
import { useChangeOwnPassword } from '../../hooks/useUsers';

interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ChangePasswordModal({ isOpen, onClose }: ChangePasswordModalProps): React.ReactElement {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const changePassword = useChangeOwnPassword();

  const reset = () => {
    setCurrentPassword(''); setNewPassword(''); setConfirm(''); setError(null);
  };

  const handleClose = () => { reset(); onClose(); };

  const handleSubmit = async () => {
    setError(null);
    if (newPassword !== confirm) { setError('New password and confirmation do not match.'); return; }
    try {
      await changePassword.mutateAsync({ currentPassword, newPassword });
      reset();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to change password.');
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Change Password" size="sm">
      <div className="p-6">
        <Input label="Current password" type="password" value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)} required />
        <Input label="New password" type="password" value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)} required />
        <Input label="Confirm new password" type="password" value={confirm}
          onChange={(e) => setConfirm(e.target.value)} required />
        <p className="text-xs text-neutral-500 -mt-2 mb-3">
          At least 8 characters, including a letter and a number.
        </p>
        {error && <p className="text-sm text-danger-600 mb-3">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button text="Cancel" variant="secondary" onClick={handleClose} />
          <Button text="Update Password" variant="primary" loading={changePassword.isPending}
            disabled={!currentPassword || !newPassword || !confirm} onClick={handleSubmit} />
        </div>
      </div>
    </Modal>
  );
}
