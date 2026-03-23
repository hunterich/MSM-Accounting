import React, { useState } from 'react';
import { useAuditLogs } from '../../hooks/useAuditLog';
import { formatDateID } from '../../utils/formatters';

const ACTION_COLORS = {
  CREATE: 'bg-green-100 text-green-800',
  UPDATE: 'bg-blue-100 text-blue-800',
  DELETE: 'bg-red-100 text-red-800',
};

/**
 * Reusable audit log panel. Pass entityType and/or entityId to filter.
 * If no filters, shows all logs for the org.
 */
const AuditLogPanel = ({ entityType, entityId, limit = 20 }) => {
  const [page, setPage] = useState(1);
  const filters = { page, limit };
  if (entityType) filters.entityType = entityType;
  if (entityId) filters.entityId = entityId;

  const { data, isLoading } = useAuditLogs(filters);
  const logs = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  const formatTime = (dateStr) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return `${formatDateID(dateStr)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  if (isLoading) {
    return <div className="text-sm text-neutral-500 p-4">Memuat log audit...</div>;
  }

  if (logs.length === 0) {
    return <div className="text-sm text-neutral-500 p-4">Belum ada riwayat aktivitas.</div>;
  }

  return (
    <div>
      <div className="divide-y divide-neutral-200">
        {logs.map((log) => (
          <div key={log.id} className="px-4 py-3 flex items-start gap-3 text-sm">
            <span className={`shrink-0 px-2 py-0.5 rounded text-xs font-medium ${ACTION_COLORS[log.action] || 'bg-neutral-100 text-neutral-700'}`}>
              {log.actionLabel}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-neutral-900">
                <span className="font-medium">{log.actorName}</span>
                {' '}
                {log.action === 'CREATE' && 'membuat'}
                {log.action === 'UPDATE' && 'mengubah'}
                {log.action === 'DELETE' && 'menghapus'}
                {' '}
                <span className="text-neutral-600">{log.entityLabel}</span>
                {' '}
                <span className="font-mono text-xs text-neutral-500">{log.entityId?.slice(0, 12)}</span>
              </div>
              {log.payload && (
                <details className="mt-1">
                  <summary className="text-xs text-neutral-400 cursor-pointer hover:text-neutral-600">Detail perubahan</summary>
                  <pre className="mt-1 text-xs bg-neutral-50 rounded p-2 overflow-x-auto max-h-40 text-neutral-600">
                    {JSON.stringify(log.payload, null, 2)}
                  </pre>
                </details>
              )}
            </div>
            <span className="shrink-0 text-xs text-neutral-400 whitespace-nowrap">
              {formatTime(log.createdAt)}
            </span>
          </div>
        ))}
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-neutral-200 text-sm">
          <span className="text-neutral-500">{total} entri</span>
          <div className="flex gap-2">
            <button
              className="px-2 py-1 rounded border border-neutral-300 text-neutral-700 disabled:opacity-40"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Sebelumnya
            </button>
            <span className="px-2 py-1 text-neutral-600">{page} / {totalPages}</span>
            <button
              className="px-2 py-1 rounded border border-neutral-300 text-neutral-700 disabled:opacity-40"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Berikutnya
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AuditLogPanel;
