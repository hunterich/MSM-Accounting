import { useState } from 'react';
import { DatabaseBackup, Download, RotateCcw, Plus, Trash2 } from 'lucide-react';
import Card from '../../components/UI/Card';
import Button from '../../components/UI/Button';
import Input from '../../components/UI/Input';
import Modal from '../../components/UI/Modal';
import StatusTag from '../../components/UI/StatusTag';
import {
  useBackupSettings, useUpdateBackupSettings, useBackupHistory,
  useRunBackup, useRestoreBackup, downloadBackupFile,
  type FolderDestination, type BackupRecord,
} from '../../hooks/useBackup';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function BackupPanel() {
  const { data: settings } = useBackupSettings();
  const updateSettings = useUpdateBackupSettings();
  const runBackup = useRunBackup();
  const restore = useRestoreBackup();
  const { data: history } = useBackupHistory(1);

  const [restoreTarget, setRestoreTarget] = useState<BackupRecord | null>(null);
  const [confirmText, setConfirmText] = useState('');

  if (!settings) return <Card title="Backup & Restore"><p>Loading…</p></Card>;

  const setDest = (idx: number, patch: Partial<FolderDestination>) => {
    const next = settings.folderDestinations.map((d, i) => (i === idx ? { ...d, ...patch } : d));
    updateSettings.mutate({ folderDestinations: next });
  };
  const addDest = () => updateSettings.mutate({
    folderDestinations: [...settings.folderDestinations, { label: 'New folder', path: '', enabled: true }],
  });
  const removeDest = (idx: number) => updateSettings.mutate({
    folderDestinations: settings.folderDestinations.filter((_, i) => i !== idx),
  });

  return (
    <div className="space-y-4">
      {!settings.pgToolsOk && (
        <Card title="⚠️ Backup tools not found">
          <p className="text-sm">{settings.pgToolsMessage}</p>
        </Card>
      )}

      <Card title="Automatic backup (recommended)">
        <label className="flex items-center gap-2 mb-3">
          <input type="checkbox" checked={settings.enabled}
            onChange={(e) => updateSettings.mutate({ enabled: e.target.checked })} />
          <span>Back up automatically</span>
        </label>
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <span>How often:</span>
          <select value={settings.frequency}
            onChange={(e) => updateSettings.mutate({ frequency: e.target.value as 'DAILY' | 'TWICE_DAILY' | 'WEEKLY' })}
            className="h-9 px-2 rounded-md border border-neutral-300 bg-neutral-0">
            <option value="TWICE_DAILY">Twice a day</option>
            <option value="DAILY">Every day</option>
            <option value="WEEKLY">Every week</option>
          </select>
          <span>at {settings.times.join(' & ')}</span>
        </div>
        <p className="text-xs opacity-70 mt-2">
          Keeps the last {settings.retentionDailyCount} daily backups + a monthly copy for {settings.retentionMonthlyCount} months.
        </p>
      </Card>

      <Card title="Manual backup">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm opacity-80">Run an extra backup now — e.g. before month-end close or an update.</p>
          <Button text="Back up now" variant="primary" icon={<DatabaseBackup size={16} />}
            loading={runBackup.isPending} onClick={() => runBackup.mutate()} />
        </div>
        {runBackup.isError && <p className="text-sm text-danger-600 mt-2">{(runBackup.error as Error).message}</p>}
      </Card>

      <Card title="Where to save" actions={<Button text="Add folder" variant="secondary" icon={<Plus size={16} />} onClick={addDest} />}>
        {settings.folderDestinations.length === 0 && (
          <p className="text-sm opacity-70">No folders yet. Add your external drive folder, Google Drive folder, or OneDrive folder.</p>
        )}
        {settings.folderDestinations.map((d, i) => (
          <div key={i} className="flex items-center gap-2 mb-2">
            <input type="checkbox" checked={d.enabled} onChange={(e) => setDest(i, { enabled: e.target.checked })} />
            <Input value={d.label} onChange={(e) => setDest(i, { label: e.target.value })} placeholder="Label" wrapperClassName="w-40" />
            <Input value={d.path} onChange={(e) => setDest(i, { path: e.target.value })} placeholder="Folder path (e.g. G:\My Drive\MSM-Backups)" wrapperClassName="flex-1" />
            <Button variant="ghost" icon={<Trash2 size={16} />} aria-label="Remove folder" onClick={() => removeDest(i)} />
          </div>
        ))}
      </Card>

      <Card title="Backup history">
        <table className="w-full text-sm">
          <thead><tr className="text-left opacity-60">
            <th className="py-2">When</th><th>Type</th><th>Size</th><th>Status</th><th className="text-right">Actions</th>
          </tr></thead>
          <tbody>
            {(history?.data ?? []).map((r) => (
              <tr key={r.id} className="border-t border-neutral-200">
                <td className="py-2">{new Date(r.createdAt).toLocaleString()}</td>
                <td>{r.type === 'AUTO' ? 'Auto' : r.type === 'MANUAL' ? 'Manual' : 'Safety'}</td>
                <td>{formatBytes(r.sizeBytes)}</td>
                <td><StatusTag status={r.status} /></td>
                <td className="text-right whitespace-nowrap">
                  {r.fileName !== '(failed)' && (
                    <>
                      <Button text="Download" variant="ghost" icon={<Download size={14} />}
                        onClick={() => downloadBackupFile(r.id, r.fileName)} />
                      <Button text="Restore" variant="danger" icon={<RotateCcw size={14} />}
                        onClick={() => { setRestoreTarget(r); setConfirmText(''); }} />
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Modal isOpen={!!restoreTarget} onClose={() => setRestoreTarget(null)} title="Restore this backup?" size="md">
        <p className="text-sm mb-3">
          This <strong>replaces all current data</strong> with the backup from{' '}
          {restoreTarget && new Date(restoreTarget.createdAt).toLocaleString()}. A safety backup is taken first.
          Make sure all other staff are logged out.
        </p>
        <p className="text-sm mb-2">Type <strong>RESTORE</strong> to confirm:</p>
        <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
        <div className="flex justify-end gap-2 mt-4">
          <Button text="Cancel" variant="secondary" onClick={() => setRestoreTarget(null)} />
          <Button text="Restore" variant="danger" disabled={confirmText !== 'RESTORE' || restore.isPending}
            loading={restore.isPending}
            onClick={async () => {
              if (!restoreTarget) return;
              await restore.mutateAsync(restoreTarget.id);
              setRestoreTarget(null);
              window.alert('Restore complete.');
            }} />
        </div>
        {restore.isError && <p className="text-sm text-danger-600 mt-2">{(restore.error as Error).message}</p>}
      </Modal>
    </div>
  );
}
