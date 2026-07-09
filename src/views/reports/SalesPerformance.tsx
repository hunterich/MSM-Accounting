import React, { useMemo, useState } from 'react';
import Card from '../../components/UI/Card';
import { formatIDR } from '../../utils/formatters';
import { useSalesPerformance, usePosTargets, useSavePosTargets } from '../../hooks/usePosReports';

function currentWibMonth(): string {
  const wib = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return `${wib.getUTCFullYear()}-${String(wib.getUTCMonth() + 1).padStart(2, '0')}`;
}

const STATUS_COLOR: Record<string, string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
};

const SalesPerformance = () => {
  const [month, setMonth] = useState<string>(currentWibMonth());
  const [editing, setEditing] = useState(false);
  const { data, isLoading } = useSalesPerformance(month);
  const rows = data?.rows ?? [];
  const totals = data?.totals ?? { target: 0, sold: 0 };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Sales Performance</h1>
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          />
          <button onClick={() => setEditing(true)} className="text-sm px-3 py-1 rounded bg-teal-600 text-white">
            Edit targets
          </button>
        </div>
      </div>

      <Card>
        {isLoading ? (
          <div className="p-6 text-sm text-gray-500">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-gray-500">No sales or targets for this month yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="py-2 px-3">Staff</th>
                <th className="py-2 px-3 text-right">Target</th>
                <th className="py-2 px-3 text-right">Sold</th>
                <th className="py-2 px-3 text-right">Remaining</th>
                <th className="py-2 px-3 text-right">%</th>
                <th className="py-2 px-3 w-40">Progress</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employeeId ?? 'unassigned'} className="border-b last:border-0">
                  <td className="py-2 px-3">
                    <span className={`inline-block w-2 h-2 rounded-full mr-2 ${r.status ? STATUS_COLOR[r.status] : 'bg-gray-300'}`} />
                    {r.name}
                  </td>
                  <td className="py-2 px-3 text-right">{r.hasTarget ? formatIDR(r.target) : '—'}</td>
                  <td className="py-2 px-3 text-right">{formatIDR(r.sold)}</td>
                  <td className="py-2 px-3 text-right">{r.hasTarget ? formatIDR(r.remaining) : '—'}</td>
                  <td className="py-2 px-3 text-right">{r.pct == null ? '—' : `${r.pct}%`}</td>
                  <td className="py-2 px-3">
                    <div className="h-2 bg-gray-200 rounded">
                      <div
                        className={`h-2 rounded ${r.status ? STATUS_COLOR[r.status] : 'bg-gray-400'}`}
                        style={{ width: `${Math.min(100, r.pct ?? 0)}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="py-2 px-3">Team total</td>
                <td className="py-2 px-3 text-right">{formatIDR(totals.target)}</td>
                <td className="py-2 px-3 text-right">{formatIDR(totals.sold)}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        )}
      </Card>

      {editing && <TargetEditor month={month} onClose={() => setEditing(false)} />}
    </div>
  );
};

function TargetEditor({ month, onClose }: { month: string; onClose: () => void }) {
  const { data } = usePosTargets(month);
  const save = useSavePosTargets();
  const [draft, setDraft] = useState<Record<string, string>>({});

  const initial = useMemo(() => {
    const m: Record<string, string> = {};
    for (const t of data?.targets ?? []) m[t.employeeId] = t.targetAmount == null ? '' : String(t.targetAmount);
    return m;
  }, [data]);

  const value = (id: string) => (id in draft ? draft[id] : (initial[id] ?? ''));

  const onSave = async () => {
    const targets = (data?.targets ?? []).map((t) => {
      const raw = value(t.employeeId).trim();
      const num = raw === '' ? null : Number(raw);
      return { employeeId: t.employeeId, targetAmount: Number.isFinite(num as number) ? (num as number) : null };
    });
    await save.mutateAsync({ month, targets });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg w-[28rem] max-h-[80vh] overflow-auto p-5 space-y-3">
        <h2 className="font-semibold">Targets — {month}</h2>
        <div className="space-y-2">
          {(data?.targets ?? []).map((t) => (
            <div key={t.employeeId} className="flex items-center justify-between gap-3">
              <span className="text-sm">{t.name}</span>
              <input
                type="number"
                min={0}
                value={value(t.employeeId)}
                onChange={(e) => setDraft((d) => ({ ...d, [t.employeeId]: e.target.value }))}
                className="border rounded px-2 py-1 text-sm w-40 text-right"
                placeholder="No target"
              />
            </div>
          ))}
          {(data?.targets ?? []).length === 0 && (
            <div className="text-sm text-gray-500">No active staff found. Add staff under HR &amp; Payroll first.</div>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="text-sm px-3 py-1 rounded border">Cancel</button>
          <button onClick={onSave} disabled={save.isPending} className="text-sm px-3 py-1 rounded bg-teal-600 text-white">
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default SalesPerformance;
